"""
services/conversation_service.py
──────────────────────────────────
Thread-safe in-memory conversation history store.
Automatically expires old conversations.
"""

import uuid
from datetime import datetime, timedelta, timezone
from threading import Lock

from config import settings
from utils.logger import get_logger

log = get_logger("conversation_service")

_store: dict[str, dict] = {}
_lock = Lock()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _purge_expired() -> None:
    """Remove conversations older than CONV_TTL_MIN. Call inside lock."""
    ttl = timedelta(minutes=settings.CONV_TTL_MIN)
    now = _utc_now()
    expired = [cid for cid, d in _store.items() if now - d["updated_at"] > ttl]
    for cid in expired:
        del _store[cid]
    if expired:
        log.debug(f"[CONV] Purged {len(expired)} expired conversation(s)")


def get_or_create(conv_id: str | None) -> tuple[str, dict]:
    """
    Return existing conversation or create a new one.
    Returns (conversation_id, conversation_dict).
    """
    with _lock:
        _purge_expired()

        if conv_id and conv_id in _store:
            conv = _store[conv_id]
            conv["updated_at"] = _utc_now()
            log.debug(f"[CONV] Resumed | id={conv_id} | messages={len(conv['messages'])}")
            return conv_id, conv

        new_id = str(uuid.uuid4())
        _store[new_id] = {
            "messages": [],
            "created_at": _utc_now(),
            "updated_at": _utc_now(),
        }
        log.info(f"[CONV] Created new | id={new_id}")
        return new_id, _store[new_id]


def append_turn(conv_id: str, question: str, sql: str) -> None:
    """Add user question and AI SQL response to conversation memory."""
    with _lock:
        if conv_id not in _store:
            return
        conv = _store[conv_id]
        conv["messages"].append({"role": "user", "content": question})
        conv["messages"].append({"role": "assistant", "content": sql})
        conv["updated_at"] = _utc_now()
        log.debug(f"[CONV] Appended turn | id={conv_id} | total_messages={len(conv['messages'])}")


def delete(conv_id: str) -> bool:
    """Delete a conversation. Returns True if it existed."""
    with _lock:
        existed = conv_id in _store
        _store.pop(conv_id, None)
        if existed:
            log.info(f"[CONV] Deleted | id={conv_id}")
        return existed


def get_history(conv: dict) -> list[dict]:
    """Return the message history slice for the AI call."""
    return conv["messages"][-settings.MAX_HISTORY:]
