# VNR VJIET Campus AI — Backend

Production-grade Flask backend. NL → SQL → Results.

---

## Folder Structure

```
backend/
├── app.py                   # App factory, CORS, rate limiting, error handlers
├── wsgi.py                  # Gunicorn entry point
├── requirements.txt
├── .env                     # Your secrets (NEVER commit this)
├── .env.example             # Safe template to share
├── .gitignore
│
├── config/
│   └── settings.py          # Centralized config with validation
│
├── routes/
│   ├── health.py            # GET  /api/v1/health
│   └── chat.py              # POST /api/v1/chat
│                            # POST /api/v1/chat/reset
│
├── services/
│   ├── groq_service.py      # All Groq AI calls
│   ├── supabase_service.py  # All Supabase calls
│   └── conversation_service.py  # In-memory conversation memory
│
├── middleware/
│   └── auth.py              # X-API-Key authentication
│
├── utils/
│   ├── logger.py            # Structured logger (console + file)
│   ├── response.py          # Standardized JSON response helpers
│   └── validators.py        # Input validation
│
├── static/                  # Frontend goes here
└── logs/                    # Auto-created on first run
```

---

## Setup (Windows PowerShell)

### 1. Install dependencies
```powershell
cd C:\vnr-ece\backend
C:\Users\devas\AppData\Local\Programs\Python\Python312\python.exe -m pip install -r requirements.txt
```

### 2. Configure your .env
The `.env` file already has your credentials filled in.
Open it and confirm everything looks correct.

### 3. Run in development
```powershell
C:\Users\devas\AppData\Local\Programs\Python\Python312\python.exe app.py
```

### 4. Test the backend
Open browser: `http://localhost:5000/api/v1/health`

Expected response:
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "groq_configured": true,
    "supabase_configured": true,
    "model": "llama-3.3-70b-versatile"
  }
}
```

---

## API Reference

### Authentication
Every protected endpoint requires this header:
```
X-API-Key: vnr-campus-ai-secret-2026
```

---

### GET /api/v1/health
Public. No auth required.

```json
{
  "success": true,
  "data": { "status": "ok", "groq_configured": true, ... }
}
```

---

### POST /api/v1/chat
Ask a natural language question.

**Request:**
```json
{
  "question": "Show all students with attendance below 75%",
  "conversation_id": "optional-uuid-for-followup-questions"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "question": "Show all students with attendance below 75%",
    "sql": "SELECT s.full_name, s.roll_number, ...",
    "rows": [ {...}, {...} ],
    "count": 18,
    "conversation_id": "some-uuid"
  },
  "meta": {
    "timestamp": "2026-03-21T10:00:00Z",
    "latency_ms": 840
  }
}
```

---

### POST /api/v1/chat/reset
Clear conversation memory.

**Request:**
```json
{ "conversation_id": "some-uuid" }
```

**Response:**
```json
{
  "success": true,
  "data": { "conversation_id": "some-uuid", "cleared": true }
}
```

---

## Rate Limits
- 30 requests per minute per IP
- 200 requests per hour per IP
- Returns 429 if exceeded

## Request Size
- Maximum payload: 1 MB
- Maximum question length: 1200 characters

---

## Logs
Auto-generated at `logs/app.log`. All requests, errors, and AI calls are logged with timestamps.
