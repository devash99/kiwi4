"""
utils/response.py
─────────────────
All API responses go through these helpers.
Guarantees a consistent JSON shape across every endpoint.

Success shape:
{
  "success": true,
  "data": { ... },
  "meta": { "timestamp": "...", "latency_ms": 0 }
}

Error shape:
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable message"
  },
  "meta": { "timestamp": "..." }
}
"""

from datetime import datetime, timezone
from flask import jsonify


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def success(data: dict, status: int = 200, latency_ms: int = 0):
    return jsonify({
        "success": True,
        "data": data,
        "meta": {
            "timestamp": _now_iso(),
            "latency_ms": latency_ms,
        }
    }), status


def error(code: str, message: str, status: int = 400):
    return jsonify({
        "success": False,
        "error": {
            "code": code,
            "message": message,
        },
        "meta": {
            "timestamp": _now_iso(),
        }
    }), status


# ── Common error shortcuts ────────────────────────────────────

def bad_request(message: str):
    return error("BAD_REQUEST", message, 400)

def unauthorized(message: str = "Invalid or missing API key."):
    return error("UNAUTHORIZED", message, 401)

def rate_limited(message: str = "Too many requests. Slow down."):
    return error("RATE_LIMITED", message, 429)

def server_error(message: str = "An internal error occurred."):
    return error("SERVER_ERROR", message, 500)

def timeout_error(message: str = "Request timed out. Try a simpler question."):
    return error("TIMEOUT", message, 504)
