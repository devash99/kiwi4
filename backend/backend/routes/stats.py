"""
routes/stats.py
────────────────
GET /api/v1/stats
Returns live department stats from Supabase.
Protected by API key (FIX #8).
"""

from flask import Blueprint
from middleware.auth import require_api_key
from utils.response import success, error
from utils.logger import get_logger
from services.supabase_service import execute_query

log = get_logger("stats_routes")

stats_bp = Blueprint("stats", __name__)


# FIX #9: Single combined query instead of 4 separate calls
_STATS_SQL = """
SELECT
    (SELECT COUNT(*) FROM students) AS total_students,
    (SELECT ROUND(AVG(attendance_percentage)::numeric, 1) FROM attendance) AS avg_attendance,
    (SELECT COUNT(*) FROM subjects) AS total_subjects,
    (SELECT MAX(semester) FROM students) AS current_semester
"""


@stats_bp.route("/stats", methods=["GET"])
@require_api_key  # FIX #8: Was missing authentication
def get_stats():
    try:
        result = execute_query(_STATS_SQL)
        row = result[0] if result else {}

        total_students = row.get("total_students", 0)
        avg_attendance = row.get("avg_attendance", 0)
        total_subjects = row.get("total_subjects", 0)
        current_semester = row.get("current_semester", "N/A")

        return success({
            "total_students": total_students,
            "avg_attendance": f"{avg_attendance}%",
            "total_subjects": total_subjects,
            "semester": f"{current_semester}/8" if isinstance(current_semester, int) else str(current_semester),
            "department": "ECE Department",
            "institution": "VNR VJIET",
        })

    except Exception as e:
        log.error(f"[STATS] Error fetching stats: {e}")
        # Return fallback so frontend doesn't break
        return success({
            "total_students": "—",
            "avg_attendance": "—",
            "total_subjects": "—",
            "current_semester": "—",
            "department": "ECE Department",
            "institution": "VNR VJIET",
        })