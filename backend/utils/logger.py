"""
utils/logger.py
───────────────
Centralized structured logger.
Writes to console (always) and logs/app.log (with rotation).
FIX #16: Uses RotatingFileHandler to prevent unbounded log growth.
"""

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

_LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
_LOG_DIR.mkdir(exist_ok=True)

_LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

# FIX #16: 5 MB per file, keep 3 backups (20 MB total max)
_MAX_BYTES = 5 * 1024 * 1024
_BACKUP_COUNT = 3


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)

    if logger.handlers:
        return logger  # Already configured

    logger.setLevel(logging.DEBUG)

    # Console handler
    ch = logging.StreamHandler()
    ch.setLevel(logging.DEBUG)
    ch.setFormatter(logging.Formatter(_LOG_FORMAT, _DATE_FORMAT))

    # File handler with rotation
    fh = RotatingFileHandler(
        _LOG_DIR / "app.log",
        maxBytes=_MAX_BYTES,
        backupCount=_BACKUP_COUNT,
        encoding="utf-8",
    )
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter(_LOG_FORMAT, _DATE_FORMAT))

    logger.addHandler(ch)
    logger.addHandler(fh)
    logger.propagate = False

    return logger
