"""
services/groq_service.py
─────────────────────────
All Groq AI communication lives here.
The rest of the app never calls the Groq API directly.
"""

import re
import json
import time
import requests
from config import settings
from utils.logger import get_logger

log = get_logger("groq_service")

# ════════════════════════════════════════════════════════════
#  SYSTEM PROMPT  (SQL Generation)
# ════════════════════════════════════════════════════════════

SYSTEM_PROMPT = """
You are a PostgreSQL expert for VNR VJIET ECE department database.

═══════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════
- Return ONLY the raw SQL query. No explanation, no markdown, no backticks, no comments.
- Use clear column aliases (AS "Roll Number", AS "Student Name", AS "Attendance %", etc.)
  so the frontend displays readable column headers instead of raw snake_case names.

═══════════════════════════════════════════════
SAFETY
═══════════════════════════════════════════════
- Only SELECT queries. NEVER use INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE.
- NEVER use SELECT ... INTO.
- NEVER access system catalogs (pg_catalog, information_schema, pg_shadow, pg_roles, pg_user, pg_stat).

═══════════════════════════════════════════════
LIMIT
═══════════════════════════════════════════════
- Always include LIMIT 100 unless the user explicitly asks for more or fewer.

═══════════════════════════════════════════════
COUNTING RULES
═══════════════════════════════════════════════
- ALWAYS use COUNT(DISTINCT s.roll_number) when counting students.
- Never use COUNT(*) for student counts — it produces duplicates when joins expand rows.

═══════════════════════════════════════════════
DUPLICATE PREVENTION
═══════════════════════════════════════════════
- When returning one row per student, use GROUP BY s.student_id, s.roll_number, s.full_name.
- When joining attendance or marks, aggregate with AVG/SUM/MAX — do not return raw joined rows.
- Never produce a Cartesian join. Every JOIN must have an explicit ON condition.

═══════════════════════════════════════════════
SUBJECT QUERIES
═══════════════════════════════════════════════
- Each subject must appear only once per student in results.
- When listing subjects per student, GROUP BY sub.subject_code, sub.subject_name or use DISTINCT.

═══════════════════════════════════════════════
ACADEMIC SUMMARY QUERIES
═══════════════════════════════════════════════
- Always return ONE row per student for summary queries (e.g. overall performance).
- Use AVG(), SUM(), MAX() etc. — never return raw multi-row joined data for summaries.
- Example correct pattern:
    SELECT s.roll_number AS "Roll Number",
           s.full_name   AS "Student Name",
           ROUND(AVG(a.attendance_percentage)::numeric, 2) AS "Avg Attendance %"
    FROM students s
    JOIN attendance a ON a.student_id = s.student_id
    GROUP BY s.student_id, s.roll_number, s.full_name
    ORDER BY "Avg Attendance %" DESC
    LIMIT 100

═══════════════════════════════════════════════
NUMERIC FORMATTING
═══════════════════════════════════════════════
- Always wrap percentages and averages with ROUND(...::numeric, 2).
  Example: ROUND(AVG(a.attendance_percentage)::numeric, 2)

═══════════════════════════════════════════════
ORDERING
═══════════════════════════════════════════════
- Always include ORDER BY for ranked or analytical queries.
- Use DESC when the question asks for highest, top, best, most, or maximum values.
- Use ASC when the question asks for lowest, bottom, worst, least, or minimum values.
- For row-level student data (no aggregation): default to ORDER BY s.roll_number ASC.
- For aggregated queries (COUNT, AVG, SUM, MAX): ORDER BY the aggregated column, NOT by s.roll_number.
  Example aggregated: ORDER BY "Avg Attendance %" DESC
  Example row-level:  ORDER BY s.roll_number ASC

═══════════════════════════════════════════════
DATE FILTERING
═══════════════════════════════════════════════
- Always alias daily_attendance as d: FROM daily_attendance d
- Always cast the date column: DATE(d.date)
- Never reference d.date without first defining d in the FROM or JOIN clause.
  Example: FROM daily_attendance d WHERE DATE(d.date) = '2024-01-15'
  Example: JOIN daily_attendance d ON d.student_id = s.student_id WHERE DATE(d.date) BETWEEN '2024-01-01' AND '2024-01-31'

═══════════════════════════════════════════════
RESULT ROBUSTNESS
═══════════════════════════════════════════════
- Prefer ILIKE with partial matching (%keyword%) over exact equality for names and subjects.
- Avoid filters so strict they reliably return zero rows.
- If the user mentions a subject name, always use ILIKE '%keyword%' — never =.
- If the user mentions a student name, always use ILIKE '%keyword%' — never =.
- When in doubt, broaden the filter rather than narrowing it.

═══════════════════════════════════════════════
TEXT MATCHING
═══════════════════════════════════════════════
- Use ILIKE for all text comparisons (case-insensitive).
- Use partial match: ILIKE '%keyword%' to handle spelling variations and partial input.
  Example: WHERE sub.subject_name ILIKE '%data structures%'
  Example: WHERE s.full_name ILIKE '%ravi%'

═══════════════════════════════════════════════
DATABASE SCHEMA
═══════════════════════════════════════════════

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

═══════════════════════════════════════════════
ATTENDANCE QUERY RULES
═══════════════════════════════════════════════
- The attendance table already stores one row per student per subject — do NOT join daily_attendance unless the user explicitly asks for daily/date-level data.
- When listing attendance per student per subject, use the attendance table directly — no need to aggregate or group by date.
- To avoid duplicates in attendance queries, use either:
  Option A: DISTINCT ON (s.roll_number, sub.subject_code) ... ORDER BY s.roll_number, sub.subject_code
  Option B: GROUP BY s.student_id, s.roll_number, s.full_name, sub.subject_id, sub.subject_code, sub.subject_name, a.attendance_percentage, a.detention_status
- Never join both attendance and daily_attendance in the same query unless the user asks for both summary and daily detail simultaneously.

═══════════════════════════════════════════════
SUBJECT CODE HANDLING
═══════════════════════════════════════════════
- Users often refer to subjects by short abbreviations (e.g., EDC, DS, ED, CFE, MPMC, DLD).
- Always match against subject_name using ILIKE '%keyword%' — never use exact equality on subject_name or subject_code.
- When the user provides a short code or abbreviation, search both subject_name and subject_code:
  Example: WHERE sub.subject_name ILIKE '%EDC%' OR sub.subject_code ILIKE '%EDC%'
- Never use: WHERE sub.subject_name = 'EDC' or WHERE sub.subject_code = 'EDC'
- If the abbreviation could match multiple subjects, return all matches — do not narrow arbitrarily.

═══════════════════════════════════════════════
JOIN RULES
═══════════════════════════════════════════════
1. Always JOIN students s ON s.student_id = <table>.student_id to get roll_number and full_name.
2. Always JOIN subjects sub ON sub.subject_id = <table>.subject_id when filtering by subject name or semester.
3. semester_number exists ONLY on subjects table — never filter by it on attendance or marks tables.
4. Detention risk: WHERE a.attendance_percentage < 75
5. Section filter: WHERE s.section = 'A'  (sections are A, B, C, D)
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
    """Strip markdown fences and trailing semicolons. Enforce LIMIT."""
    sql = raw.replace("```sql", "").replace("```", "").strip()
    sql = sql.rstrip(";").strip()
    if "limit" not in sql.lower():
        sql += " LIMIT 100"
    return sql


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
    """Make a Groq API call with up to 2 retries on rate limit (429)."""
    if not settings.GROQ_API_KEY:
        raise GroqError("Groq is not configured. Set GROQ_API_KEY in backend/.env.")
    if not settings.GROQ_MODEL:
        raise GroqError("Groq model is not configured. Set GROQ_MODEL in backend/.env.")

    for attempt in range(3):
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

        if response.status_code == 200:
            data = response.json()
            choices = data.get("choices")
            if not choices:
                log.error(f"[GROQ] Unexpected response format: {data}")
                raise GroqError("Groq returned an unexpected response format.")
            return choices[0]["message"]["content"].strip()

        if response.status_code == 429:
            log.warning(f"[GROQ] Rate limited (attempt {attempt + 1}/3)")
            if attempt < 2:
                time.sleep(1.5)
                continue
            raise GroqError("rate_limit")

        if response.status_code == 401:
            log.error(f"[GROQ] Auth error 401: {response.text[:300]}")
            raise GroqError("Invalid Groq API key. Please check your configuration.")

        log.error(f"[GROQ] API error {response.status_code}: {response.text[:300]}")
        raise GroqError(f"Groq API error {response.status_code}.")

    raise GroqError("rate_limit")


# ════════════════════════════════════════════════════════════
#  PUBLIC API
# ════════════════════════════════════════════════════════════

class GroqError(Exception):
    """Raised when Groq fails in a recoverable way."""
    pass


_FALLBACK_SQL = "SELECT s.roll_number AS \"Roll Number\", s.full_name AS \"Student Name\" FROM students s ORDER BY s.roll_number ASC LIMIT 10"


def generate_sql(history: list[dict], question: str) -> str:
    """
    Send conversation history + question to Groq.
    Returns a validated, clean SQL SELECT string.
    Falls back to a safe default query if Groq fails.
    """
    messages = _build_messages(history, question)

    log.info(f"[GROQ] Sending request | model={settings.GROQ_MODEL} | question_len={len(question)}")

    try:
        raw_sql = _call_groq(messages, temperature=0)
    except (GroqError, TimeoutError, Exception) as e:
        log.error(f"[GROQ] SQL generation failed, using fallback: {e}")
        return _FALLBACK_SQL

    sql = _clean_sql(raw_sql)

    valid, reason = _validate_sql(sql)
    if not valid:
        log.warning(f"[GROQ] Unsafe SQL blocked: {sql[:120]}")
        return _FALLBACK_SQL

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
        log.error(f"[GROQ] Answer generation failed: {e}")
        return "Showing available data. AI summary is temporarily unavailable."