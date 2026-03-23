"""
config/settings.py
──────────────────
Single source of truth for all configuration.
Loads from .env, validates required fields, and exposes typed constants.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from the backend root directory
_BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(_BASE_DIR / ".env")


def _require(key: str) -> str:
    """Read an env var or raise a clear startup error."""
    value = os.getenv(key, "").strip()
    if not value:
        raise EnvironmentError(
            f"\n[CONFIG ERROR] Missing required environment variable: {key}\n"
            f"  → Add it to your .env file and restart the server.\n"
        )
    return value


def _optional(key: str, default: str = "") -> str:
    return os.getenv(key, default).strip()


# ── Required ─────────────────────────────────────────────────
SUPABASE_URL: str = _require("SUPABASE_URL")
SUPABASE_KEY: str = _require("SUPABASE_KEY")
GROQ_API_KEY: str = _require("GROQ_API_KEY")
APP_API_KEY:  str = _require("APP_API_KEY")

# ── Optional with defaults ────────────────────────────────────
GROQ_MODEL:            str   = _optional("GROQ_MODEL", "llama-3.3-70b-versatile")
FLASK_ENV:             str   = _optional("FLASK_ENV", "production")
FLASK_DEBUG:           bool  = _optional("FLASK_DEBUG", "false").lower() == "true"
PORT:                  int   = int(_optional("PORT", "5000"))
REQUEST_TIMEOUT:       float = float(_optional("REQUEST_TIMEOUT_SECONDS", "30"))
MAX_HISTORY:           int   = int(_optional("MAX_HISTORY_MESSAGES", "12"))
MAX_QUESTION_LEN:      int   = int(_optional("MAX_QUESTION_LENGTH", "1200"))
CONV_TTL_MIN:          int   = int(_optional("CONVERSATION_TTL_MINUTES", "180"))
RATE_LIMIT_PER_MINUTE: int   = int(_optional("RATE_LIMIT_PER_MINUTE", "30"))
RATE_LIMIT_PER_HOUR:   int   = int(_optional("RATE_LIMIT_PER_HOUR", "200"))

# FIX #11: CORS — set ALLOWED_ORIGINS in .env to your production domain(s).
# Example production: ALLOWED_ORIGINS=https://kiwi.vnrvjiet.ac.in
# NEVER use "*" in production — it disables CORS protection entirely.
ALLOWED_ORIGINS: list[str] = [
    o.strip()
    for o in _optional(
        "ALLOWED_ORIGINS",
        "http://localhost:3000,http://localhost:5173,http://localhost:5000"
    ).split(",")
    if o.strip()
]
