"""
wsgi.py
────────
Production entry point.
Run with gunicorn:

  gunicorn wsgi:application --bind 0.0.0.0:5000 --workers 4
"""

from app import create_app

application = create_app()
