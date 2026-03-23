"""
services/groq_service.py
─────────────────────────
All Groq AI communication lives here.
The rest of the app never calls the Groq API directly.
"""

import re
import json
import requests
from config import settings
from utils.logger import get_logger

log = get_logger("groq_service")

# ════════════════════════════════════════════════════════════
#  SYSTEM PROMPT  (SQL Generation)
# ════════════════════════════════════════════════════════════

SYSTEM_PROMPT = """
You are a PostgreSQL expert for VNR VJIET ECE department database.

STRICT RULES:
- Only generate SELECT queries. NEVER write INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE or any destructive SQL.
- Return ONLY the raw SQL query. No explanation, no markdown, no backticks, no comments.
- Always LIMIT results to 100 rows unless the user explicitly asks for more.
- Always ORDER results sensibly (by roll_number, attendance_percentage, or name).
- NEVER use SELECT ... INTO.
- NEVER access system catalogs (pg_catalog, information_schema, pg_shadow, pg_roles, pg_user, pg_stat).

DATABASE SCHEMA:

students (
  student_id, roll_number, full_name, date_of_birth, gender,
  blood_group, nationality, category, personal_phone, college_email,
  current_address, branch, year, semester, section
)

parents_guardians (
  id, student_id,
  father_full_name, father_phone,
  mother_full_name, mother_phone
)

subjects (
  subject_id, subject_code, subject_name,
  subject_type, semester_number, credits
)

attendance (
  attendance_id, student_id, subject_id,
  total_classes_held, total_classes_attended,
  total_classes_missed, attendance_percentage, detention_status
)

daily_attendance (
  daily_id, student_id, subject_id, date, status
)

sessional_marks (
  sessional_id, student_id, subject_id,
  sessional_number, written_marks, ca_marks, ela_marks, sessional_total
)

cie_summary (
  cie_id, student_id, subject_id,
  se1_written, se1_ca, se1_ela, total_cie_marks
)

practical_marks (
  practical_id, student_id, subject_id,
  day_to_day, record_work, internal_practical_exam,
  course_project, total_cie
)

JOIN RULES (mandatory):
1. Always JOIN students ON students.student_id = <table>.student_id to include full_name and roll_number.
2. Always JOIN subjects ON subjects.subject_id = <table>.subject_id when filtering by subject name or semester.
3. Never assume semester_number exists on attendance or any table other than subjects.
4. For detention risk: WHERE attendance.attendance_percentage < 75
5. For section queries: WHERE students.section = 'A'  (or B, C, D)
""".strip()

# ── SYSTEM PROMPT (Answer Summarization) ──────────────────
ANSWER_PROMPT = """
You are a concise academic data assistant for the VNR VJIET ECE department.
Given a user question, the SQL query that was run, and the results, write a brief,
human-friendly summary of the findings in 1-3 sentences.

Rules:
- Be factual and specific. Mention key numbers.
- Do NOT repeat the raw data or list every row — the user will see the table.
- Use **bold** for important numbers or names.
- If there are zero results, say so clearly and suggest the user rephrase.
- Never mention SQL, databases, or technical details.
""".strip()

# ── Keywords that must never appear in generated SQL ─────────
_FORBIDDEN = {
    "insert", "update", "delete", "drop", "alter",
    "create", "truncate", "grant", "revoke", "execute",
    "call", "copy", "merge", "replace", "into",
    "pg_catalog", "information_schema", "pg_shadow",
    "pg_roles", "pg_user", "pg_stat", "pg_authid",
}


# ════════════════════════════════════════════════════════════
#  INTERNAL HELPERS
# ════════════════════════════════════════════════════════════

def _clean_sql(raw: str) -> str:
    """Strip markdown fences and trailing semicolons."""
    sql = raw.replace("```sql", "").replace("```", "").strip()
    return sql.rstrip(";").strip()


def _validate_sql(sql: str) -> tuple[bool, str]:
    """Reject anything that isn't a safe SELECT."""
    lowered = sql.lower().strip()

    if not lowered:
        return False, "AI returned an empty query. Please rephrase your question."

    if ";" in lowered:
        return False, "Multiple SQL statements are not allowed."

    if not (lowered.startswith("select") or lowered.startswith("with")):
        return False, "Only SELECT queries are permitted."

    # Block SELECT ... INTO (table creation)
    if re.search(r'\bselect\b.*\binto\b\s+\w', lowered):
        return False, "SELECT INTO is not allowed."

    for kw in _FORBIDDEN:
        # Skip 'into' here since it's handled above with context
        if kw == "into":
            continue
        if re.search(rf"\b{re.escape(kw)}\b", lowered):
            return False, f"Blocked SQL keyword: {kw.upper()}"

    return True, ""


def _build_messages(history: list[dict], question: str) -> list[dict]:
    tail = history[-settings.MAX_HISTORY:]
    return (
        [{"role": "system", "content": SYSTEM_PROMPT}]
        + tail
        + [{"role": "user", "content": question}]
    )


def _call_groq(messages: list[dict], temperature: float = 0) -> str:
    """Make a single Groq API call and return the content string."""
    try:
        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.GROQ_MODEL,
                "messages": messages,
                "temperature": temperature,
            },
            timeout=settings.REQUEST_TIMEOUT,
        )
    except requests.Timeout:
        log.error("[GROQ] Request timed out")
        raise TimeoutError("Groq API request timed out.")
    except requests.RequestException as e:
        log.error(f"[GROQ] Network error: {e}")
        raise GroqError(f"Network error reaching Groq: {e}")

    if response.status_code >= 400:
        log.error(f"[GROQ] API error {response.status_code}: {response.text[:200]}")
        raise GroqError(f"Groq API returned error {response.status_code}.")

    data = response.json()
    choices = data.get("choices")
    if not choices:
        log.error(f"[GROQ] Unexpected response format: {data}")
        raise GroqError("Groq returned an unexpected response format.")

    return choices[0]["message"]["content"].strip()


# ════════════════════════════════════════════════════════════
#  PUBLIC API
# ════════════════════════════════════════════════════════════

class GroqError(Exception):
    """Raised when Groq fails in a recoverable way."""
    pass


def generate_sql(history: list[dict], question: str) -> str:
    """
    Send conversation history + question to Groq.
    Returns a validated, clean SQL SELECT string.
    Raises GroqError on any failure.
    """
    messages = _build_messages(history, question)

    log.info(f"[GROQ] Sending request | model={settings.GROQ_MODEL} | question_len={len(question)}")

    raw_sql = _call_groq(messages, temperature=0)
    sql = _clean_sql(raw_sql)

    valid, reason = _validate_sql(sql)
    if not valid:
        log.warning(f"[GROQ] Unsafe SQL blocked: {sql[:120]}")
        raise GroqError(reason)

    log.info(f"[GROQ] SQL generated successfully | length={len(sql)}")
    return sql


def generate_answer(question: str, sql: str, rows: list[dict], count: int) -> str:
    """
    Generate a human-friendly summary of the query results.
    Returns a natural-language answer string.
    Falls back to a template answer if the AI call fails.
    """
    # Template fallback for edge cases
    if count == 0:
        return "No matching records found for your query. Try adjusting your criteria or rephrasing the question."

    # Build a concise preview of the data (max 5 rows) to keep token usage low
    preview_rows = rows[:5]
    rows_preview = json.dumps(preview_rows, indent=2, default=str)
    if count > 5:
        rows_preview += f"\n... and {count - 5} more rows"

    messages = [
        {"role": "system", "content": ANSWER_PROMPT},
        {"role": "user", "content": (
            f"Question: {question}\n"
            f"SQL: {sql}\n"
            f"Total results: {count}\n"
            f"Sample data:\n{rows_preview}"
        )},
    ]

    try:
        answer = _call_groq(messages, temperature=0.3)
        log.info(f"[GROQ] Answer generated | length={len(answer)}")
        return answer
    except Exception as e:
        log.warning(f"[GROQ] Answer generation failed, using template: {e}")
        return f"Found **{count}** result{'s' if count != 1 else ''} for your query."
