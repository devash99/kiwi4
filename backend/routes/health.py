"""
routes/health.py
─────────────────
Public health check — no auth required.
Frontend pings GET /api/v1/health to check if backend is alive.
"""

from datetime import datetime, timezone
from flask import Blueprint
from config import settings
from utils.response import success

health_bp = Blueprint("health", __name__)


@health_bp.route("/health", methods=["GET"])
def health():
    return success({
        "status": "ok",
        "groq_configured": bool(settings.GROQ_API_KEY),
        "supabase_configured": bool(settings.SUPABASE_URL and settings.SUPABASE_KEY),
        "model": settings.GROQ_MODEL,
        "environment": settings.FLASK_ENV,
    })
