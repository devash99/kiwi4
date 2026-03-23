"""
middleware/auth.py
──────────────────
API key authentication middleware.

Every protected route must include this header:
  X-API-Key: <your APP_API_KEY from .env>

Usage:
  from middleware.auth import require_api_key

  @app.route("/api/v1/chat", methods=["POST"])
  @require_api_key
  def chat():
      ...
"""

import functools
from flask import request
from config import settings
from utils.response import unauthorized
from utils.logger import get_logger

log = get_logger("auth")


def require_api_key(f):
    """Decorator that enforces X-API-Key header on any route."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        api_key = request.headers.get("X-API-Key", "").strip()

        if not api_key:
            log.warning(f"[AUTH] Missing API key | IP: {request.remote_addr}")
            return unauthorized("API key is required. Include 'X-API-Key' header.")

        if api_key != settings.APP_API_KEY:
            log.warning(f"[AUTH] Invalid API key | IP: {request.remote_addr}")
            return unauthorized("Invalid API key.")

        return f(*args, **kwargs)
    return decorated
