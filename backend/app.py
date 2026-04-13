"""
app.py
───────
Application factory. Wires everything together:
  - CORS
  - Rate limiting
  - Blueprints (routes)
  - Error handlers
  - Request size limit
  - Static file serving
"""

import os
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from config import settings
from routes.health import health_bp
from routes.chat import chat_bp
from routes.stats import stats_bp
from utils.logger import get_logger
from utils.response import error

log = get_logger("app")


def create_app() -> Flask:
    app = Flask(__name__, static_folder="static")

    # ── Request size limit (1 MB max) ────────────────────────
    app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024

    # ── CORS ─────────────────────────────────────────────────
    CORS(app, origins=settings.ALLOWED_ORIGINS, supports_credentials=True)

    # ── Rate limiting ─────────────────────────────────────────
    limiter = Limiter(
        key_func=get_remote_address,
        app=app,
        default_limits=[
            f"{settings.RATE_LIMIT_PER_MINUTE} per minute",
            f"{settings.RATE_LIMIT_PER_HOUR} per hour",
        ],
        # FIX #24: In production, use Redis for shared rate limiting across workers:
        #   storage_uri="redis://localhost:6379"
        # "memory://" resets per-worker and on restart — fine for dev only.
        storage_uri="memory://",
    )

    # ── Register blueprints under /api/v1 ────────────────────
    app.register_blueprint(health_bp, url_prefix="/api/v1")
    app.register_blueprint(chat_bp,   url_prefix="/api/v1")
    app.register_blueprint(stats_bp, url_prefix="/api/v1")

    # Apply stricter rate limit to AI endpoint specifically
    limiter.limit(f"{settings.RATE_LIMIT_PER_MINUTE} per minute")(
        chat_bp
    )

    # ── Global error handlers ─────────────────────────────────

    @app.errorhandler(400)
    def bad_request(e):
        return error("BAD_REQUEST", "Malformed request.", 400)

    @app.errorhandler(401)
    def unauthorized(e):
        return error("UNAUTHORIZED", "Authentication required.", 401)

    @app.errorhandler(404)
    def not_found(e):
        return error("NOT_FOUND", f"Endpoint not found.", 404)

    @app.errorhandler(405)
    def method_not_allowed(e):
        return error("METHOD_NOT_ALLOWED", "HTTP method not allowed on this endpoint.", 405)

    @app.errorhandler(413)
    def payload_too_large(e):
        return error("PAYLOAD_TOO_LARGE", "Request body exceeds 1 MB limit.", 413)

    @app.errorhandler(429)
    def rate_limited(e):
        return error("RATE_LIMITED", "Too many requests. Please slow down.", 429)

    @app.errorhandler(500)
    def server_error(e):
        log.error(f"[APP] Unhandled 500 error: {e}")
        return error("SERVER_ERROR", "An internal server error occurred.", 500)

    @app.errorhandler(504)
    def gateway_timeout(e):
        return error("TIMEOUT", "Request timed out.", 504)

    # ── Static files (frontend will live here) ────────────────
    @app.route("/")
    def index():
        return send_from_directory("static", "index.html")

    @app.route("/<path:path>")
    def static_files(path):
        try:
            return send_from_directory("static", path)
        except Exception:
            return send_from_directory("static", "index.html")

    log.info("=" * 52)
    log.info("  VNR VJIET Campus AI — Backend Started")
    log.info(f"  Environment : {settings.FLASK_ENV}")
    log.info(f"  API key set : {'OK' if settings.APP_API_KEY else 'NOT SET'}")
    log.info(f"  Supabase    : {'OK' if settings.SUPABASE_URL else 'NOT SET'}")
    log.info(f"  Groq AI     : {'OK' if settings.GROQ_API_KEY else 'NOT SET'}")
    log.info(f"  Model       : {settings.GROQ_MODEL}")
    log.info(f"  Rate limit  : {settings.RATE_LIMIT_PER_MINUTE}/min, {settings.RATE_LIMIT_PER_HOUR}/hr")
    log.info(f"  CORS origins: {settings.ALLOWED_ORIGINS}")
    log.info("=" * 52)

    return app


# ── Entry point ───────────────────────────────────────────────
if __name__ == "__main__":
    application = create_app()
    application.run(
        debug=settings.FLASK_DEBUG,
        port=settings.PORT,
        host="0.0.0.0",
    )
