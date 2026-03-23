"""
services/supabase_service.py
─────────────────────────────
All Supabase / database communication lives here.
The rest of the app never touches supabase directly.
"""

from supabase import create_client, Client
from config import settings
from utils.logger import get_logger

log = get_logger("supabase_service")

# ── Single shared client ──────────────────────────────────────
_client: Client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)


class DatabaseError(Exception):
    """Raised when a database query fails."""
    pass


def execute_query(sql: str) -> list[dict]:
    """
    Run a raw SQL SELECT via the Supabase run_query RPC function.
    Returns a list of row dicts, or [] if no results.
    Raises DatabaseError on failure.
    """
    log.info(f"[DB] Executing query | length={len(sql)}")

    try:
        result = _client.rpc("run_query", {"query": sql}).execute()
    except Exception as e:
        log.error(f"[DB] Supabase RPC error: {e}")
        raise DatabaseError(f"Database query failed: {e}")

    rows = result.data if result and result.data else []
    log.info(f"[DB] Query complete | rows_returned={len(rows)}")
    return rows
