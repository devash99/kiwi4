"""
services/supabase_service.py
All Supabase/database communication lives here.
"""

from supabase import Client, create_client

from config import settings
from utils.logger import get_logger

log = get_logger("supabase_service")


class DatabaseError(Exception):
    """Raised when a database query fails."""


_client: Client | None = None


def _get_client() -> Client:
    global _client

    if _client is not None:
        return _client

    if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
        raise DatabaseError(
            "Supabase is not configured. Set SUPABASE_URL and SUPABASE_KEY in backend/.env."
        )

    _client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
    return _client


def execute_query(sql: str) -> list[dict]:
    """
    Run a raw SQL SELECT via the Supabase run_query RPC function.
    Returns row dicts or [].
    """
    log.info(f"[DB] Executing query | length={len(sql)}")

    try:
        result = _get_client().rpc("run_query", {"query": sql}).execute()
    except DatabaseError:
        raise
    except Exception as exc:
        log.error(f"[DB] Supabase RPC error: {exc}")
        raise DatabaseError(f"Database query failed: {exc}")

    rows = result.data if result and result.data else []
    log.info(f"[DB] Query complete | rows_returned={len(rows)}")
    return rows
