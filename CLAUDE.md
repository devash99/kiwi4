# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**VNR VJIET Campus AI** — a natural-language-to-SQL chat interface for the ECE department at VNR VJIET. Users ask questions in plain English; the backend translates them to SQL via Groq AI (LLM), runs the query on Supabase (PostgreSQL), and returns results with a human-friendly summary.

Stack: Python/Flask backend + React/TypeScript/Vite frontend with Tailwind CSS v4.

---

## Development Commands

### Backend

```bash
# From the backend/ directory — ALWAYS run from here so .env resolves correctly
cd backend

# Install dependencies (use the system Python or venv)
pip install -r requirements.txt

# Run dev server (port 5000)
python app.py

# Production (gunicorn)
gunicorn wsgi:application
```

Health check: `http://localhost:5000/api/v1/health`

### Frontend

```bash
cd frontend

# Install
npm install   # or: bun install

# Dev server (port 5173)
npm run dev

# Type-check + build
npm run build

# Lint
npm run lint

# Preview production build
npm run preview
```

### Environment Setup

1. Copy `backend/.env.example` → `backend/.env` and fill in `APP_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`, `GROQ_API_KEY`.
2. Copy `frontend/.env.example` → `frontend/.env` and set `VITE_API_KEY` (same value as `APP_API_KEY`) and `VITE_API_BASE`.

---

## Architecture

### Request Flow

```
User question (React UI)
  → POST /api/v1/chat  (X-API-Key header required)
  → auth middleware validates API key
  → conversation_service retrieves/creates session (in-memory, TTL=3h)
  → groq_service.generate_sql() → Groq LLM → SQL SELECT
  → groq_service._validate_sql() → blocks non-SELECT / forbidden keywords
  → supabase_service.execute_query() → Supabase RPC `run_query`
  → groq_service.generate_answer() → human summary
  → JSON response with sql, rows, answer, conversation_id
```

### Backend (`backend/`)

- **`app.py`** — Flask app factory. Registers blueprints under `/api/v1`, sets CORS, rate limits, global error handlers, and static file serving (serves the built frontend from `static/`).
- **`config/settings.py`** — Single source of truth for all env vars. `APP_API_KEY` is required; other service keys are optional (allows health endpoint to work without them).
- **`middleware/auth.py`** — `@require_api_key` decorator; validates `X-API-Key` header against `settings.APP_API_KEY`.
- **`services/groq_service.py`** — All Groq LLM calls. Contains the hardcoded database schema in `SYSTEM_PROMPT`, SQL validation logic (`_validate_sql`), and two-step AI pipeline: `generate_sql()` then `generate_answer()`. SQL must pass keyword blocklist before being executed.
- **`services/supabase_service.py`** — Executes SQL via Supabase RPC function `run_query`. Lazily initializes the client.
- **`services/conversation_service.py`** — Thread-safe in-memory dict keyed by UUID. Stores `{messages, created_at, updated_at}`. Purges expired sessions on each access. Not persistent across restarts.
- **`routes/chat.py`** — `POST /api/v1/chat` and `POST /api/v1/chat/reset`.
- **`routes/stats.py`** — Stats endpoint for the dashboard header.
- **`utils/response.py`** — Standardized `success(data)` / `error(code, msg, status)` JSON wrappers.

### Frontend (`frontend/src/`)

- **`App.tsx`** — Entire frontend in a single file. Manages chat sessions (persisted to `localStorage` per user via `kiwi-sessions-v2-{userId}`), sidebar navigation, message rendering with data tables, and the `/api/v1/chat` API calls.
- **`types.ts`** — `Message` and `ChatResponse` interfaces.
- **`mockData.ts`** — Mock responses used during development without a live backend.
- **`index.css`** — Global styles.

### Database Schema (Supabase/PostgreSQL)

Tables: `students`, `parents_guardians`, `subjects`, `attendance`, `daily_attendance`, `sessional_marks`, `cie_summary`, `practical_marks`.

The full schema with JOIN rules is embedded in `groq_service.SYSTEM_PROMPT`. **When the schema changes, update that prompt.**

---

## Key Constraints

- The Groq service only permits `SELECT` / `WITH` queries. SQL containing DML/DDL keywords is rejected before reaching Supabase.
- Conversation history is **in-memory only** — it resets on server restart. Production would need Redis or a DB-backed store.
- Rate limits default to 30/min and 200/hr per IP (in-memory, not shared across workers).
- The backend serves the compiled frontend from `backend/static/` — run `npm run build` in `frontend/` and copy/symlink the output there for a unified deployment.
- `VITE_API_KEY` in the frontend `.env` must match `APP_API_KEY` in the backend `.env`.
