# Email Agent Backend (FastAPI)

FastAPI backend for the Email Agent app. Provides:
- OAuth + multi-user session auth
- Gmail threads + thread detail
- Priority Inbox (triage) with streaming SSE progress
- Thread Chat (SSE) + save draft to Gmail (multi-account safe)
- Inbox Copilot (Assist Chat) with session persistence + tools + RAG
- Suggested Schedule (Calendar): generate suggestions + confirm to create events

## Quickstart

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python init_database.py
python main.py
```

Default:
- API base: `http://localhost:5001/api`
- Docs: `http://localhost:5001/docs`

## Key Routes

- **Auth**
  - `GET /api/auth/google/login`
  - `GET /api/auth/google/callback`
  - `GET /api/auth/me`
  - `POST /api/auth/logout`
- **Gmail**
  - `GET /api/gmail/threads`
  - `GET /api/gmail/threads/{thread_id}`
- **Priority Inbox (Triage)**
  - `POST /api/triage/run` (SSE)
  - `GET /api/triage/results`
  - `GET /api/triage/stats`
- **Thread Chat**
  - `POST /api/thread-chat/ask` (SSE)
  - `POST /api/thread-chat/save-draft`
- **Inbox Copilot (Assist Chat)**
  - `POST /api/assist-chat/ask` (SSE)
  - `GET /api/assist-chat/sessions`
- **Calendar**
  - `GET /api/calendar/suggestions`
  - `POST /api/calendar/confirm`
