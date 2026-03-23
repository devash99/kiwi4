"""
routes/chat.py
───────────────
Protected chat endpoints.
All routes require X-API-Key header.

POST /api/v1/chat       → Ask a question
POST /api/v1/chat/reset → Clear conversation memory
"""

import time
from flask import Blueprint, request

from middleware.auth import require_api_key
from services import groq_service, supabase_service, conversation_service
from utils.validators import validate_chat_request, validate_reset_request
from utils.response import success, bad_request, server_error, timeout_error
from utils.logger import get_logger

log = get_logger("chat_routes")

chat_bp = Blueprint("chat", __name__)


@chat_bp.route("/chat", methods=["POST"])
@require_api_key
def chat():
    """
    Natural language → SQL → results → answer.

    Request body:
    {
      "question": "Show students with attendance below 75%",
      "conversation_id": "optional-uuid"
    }

    Response:
    {
      "success": true,
      "data": {
        "question": "...",
        "sql": "SELECT ...",
        "answer": "Here are the students with ...",
        "rows": [...],
        "count": 12,
        "conversation_id": "uuid"
      },
      "meta": { "timestamp": "...", "latency_ms": 840 }
    }
    """
    started = time.time()

    # ── Parse body ────────────────────────────────────────────
    body = request.get_json(silent=True) or {}

    valid, err_msg = validate_chat_request(body)
    if not valid:
        return bad_request(err_msg)

    question = body["question"].strip()
    incoming_conv_id = (body.get("conversation_id") or "").strip() or None

    log.info(f"[CHAT] New question | conv_id={incoming_conv_id} | len={len(question)}")

    # ── Conversation memory ───────────────────────────────────
    conv_id, conv = conversation_service.get_or_create(incoming_conv_id)
    history = conversation_service.get_history(conv)

    # ── Generate SQL via Groq ─────────────────────────────────
    try:
        sql = groq_service.generate_sql(history, question)
    except TimeoutError:
        return timeout_error()
    except groq_service.GroqError as e:
        log.error(f"[CHAT] Groq error: {e}")
        return bad_request(str(e))
    except Exception as e:
        log.error(f"[CHAT] Unexpected Groq error: {e}")
        return server_error("AI service error. Please try again.")

    # ── Run query on Supabase ─────────────────────────────────
    try:
        rows = supabase_service.execute_query(sql)
    except supabase_service.DatabaseError as e:
        log.error(f"[CHAT] Database error: {e}")
        return server_error("Database query failed. Please try again.")
    except Exception as e:
        log.error(f"[CHAT] Unexpected database error: {e}")
        return server_error("Unexpected database error.")

    # ── FIX #5: Generate human-friendly answer ────────────────
    answer = groq_service.generate_answer(question, sql, rows, len(rows))

    # ── Save turn to memory ───────────────────────────────────
    conversation_service.append_turn(conv_id, question, sql)

    latency = int((time.time() - started) * 1000)
    log.info(f"[CHAT] Success | conv_id={conv_id} | rows={len(rows)} | latency={latency}ms")

    return success({
        "question": question,
        "sql": sql,
        "answer": answer,
        "rows": rows,
        "count": len(rows),
        "conversation_id": conv_id,
    }, latency_ms=latency)


@chat_bp.route("/chat/reset", methods=["POST"])
@require_api_key
def reset_chat():
    """
    Clear conversation memory for a given conversation_id.

    Request body:
    { "conversation_id": "uuid" }
    """
    body = request.get_json(silent=True) or {}

    valid, err_msg = validate_reset_request(body)
    if not valid:
        return bad_request(err_msg)

    conv_id = body["conversation_id"].strip()
    existed = conversation_service.delete(conv_id)

    return success({
        "conversation_id": conv_id,
        "cleared": existed,
    })
