"""
utils/validators.py
───────────────────
Input validation for all incoming request bodies.
Returns (is_valid: bool, error_message: str).
"""

from config import settings


def validate_chat_request(body: dict) -> tuple[bool, str]:
    """
    Validate the /api/v1/chat POST body.
    Required: { "question": "string" }
    Optional: { "conversation_id": "uuid-string" }
    """
    if not isinstance(body, dict):
        return False, "Request body must be a JSON object."

    question = body.get("question")

    if question is None:
        return False, "Field 'question' is required."

    if not isinstance(question, str):
        return False, "Field 'question' must be a string."

    question = question.strip()

    if not question:
        return False, "Field 'question' cannot be empty."

    if len(question) > settings.MAX_QUESTION_LEN:
        return False, (
            f"Question is too long. "
            f"Maximum allowed length is {settings.MAX_QUESTION_LEN} characters."
        )

    conv_id = body.get("conversation_id")
    if conv_id is not None and not isinstance(conv_id, str):
        return False, "Field 'conversation_id' must be a string."

    return True, ""


def validate_reset_request(body: dict) -> tuple[bool, str]:
    """
    Validate the /api/v1/chat/reset POST body.
    Required: { "conversation_id": "uuid-string" }
    """
    if not isinstance(body, dict):
        return False, "Request body must be a JSON object."

    conv_id = body.get("conversation_id")

    if not conv_id:
        return False, "Field 'conversation_id' is required."

    if not isinstance(conv_id, str) or not conv_id.strip():
        return False, "Field 'conversation_id' must be a non-empty string."

    return True, ""
