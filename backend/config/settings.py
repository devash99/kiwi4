"""
config/settings.py
Single source of truth for runtime configuration.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

_BASE_DIR = Path(__file__).resolve().parent.parent
_DOTENV_PATH = _BASE_DIR / ".env"

# Load backend/.env no matter where the process is started from.
# Keep already-exported shell variables as highest precedence.
load_dotenv(_DOTENV_PATH)
# Also load default-discovered .env for CLI workflows.
load_dotenv()


def _require(key: str) -> str:
    value = os.getenv(key, "").strip()
    if not value:
        raise EnvironmentError(
            f"\n[CONFIG ERROR] Missing required environment variable: {key}\n"
            f"  -> Add it to backend/.env and restart the server.\n"
        )
    return value


def _optional(key: str, default: str = "") -> str:
    return os.getenv(key, default).strip()


def _to_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _mask_secret(value: str) -> str:
    if not value:
        return "(missing)"
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}...{value[-4:]}"


# Required for API authentication.
APP_API_KEY: str = _require("APP_API_KEY")

# Service credentials are optional at import time so health checks still work.
SUPABASE_URL: str = _optional("SUPABASE_URL")
SUPABASE_KEY: str = _optional("SUPABASE_KEY")
GROQ_API_KEY: str = _optional("GROQ_API_KEY")
GROQ_MODEL: str = _optional("GROQ_MODEL", "llama-3.3-70b-versatile")

# Runtime defaults.
FLASK_ENV: str = _optional("FLASK_ENV", "production")
FLASK_DEBUG: bool = _to_bool(_optional("FLASK_DEBUG", "false"))
PORT: int = int(_optional("PORT", "5000"))
REQUEST_TIMEOUT: float = float(_optional("REQUEST_TIMEOUT_SECONDS", "30"))
MAX_HISTORY: int = int(_optional("MAX_HISTORY_MESSAGES", "12"))
MAX_QUESTION_LEN: int = int(_optional("MAX_QUESTION_LENGTH", "1200"))
CONV_TTL_MIN: int = int(_optional("CONVERSATION_TTL_MINUTES", "180"))
RATE_LIMIT_PER_MINUTE: int = int(_optional("RATE_LIMIT_PER_MINUTE", "30"))
RATE_LIMIT_PER_HOUR: int = int(_optional("RATE_LIMIT_PER_HOUR", "200"))

ALLOWED_ORIGINS: list[str] = [
    origin.strip()
    for origin in _optional(
        "ALLOWED_ORIGINS",
        "http://localhost:3000,http://localhost:5173,http://localhost:5000",
    ).split(",")
    if origin.strip()
]

ENV_DEBUG: bool = _to_bool(_optional("ENV_DEBUG", "false"))
