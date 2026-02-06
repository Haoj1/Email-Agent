# Email Agent (Multi‑User AI Email Copilot)

Gmail + Google Calendar powered email workflow app with:
- **Inbox Copilot**: global assistant with tool calling + RAG (semantic search)
- **Conversations**: browse email threads with filters + pagination
- **Priority Inbox**: triage labels + priority score + streaming run progress
- **Suggested Schedule**: auto-plan follow‑ups onto your calendar (week grid) and confirm to create events

## UI Pages (Frontend Names)

- **Dashboard** (`/dashboard`): overview + quick actions + Suggested Schedule
- **Conversations** (`/threads`): browse email conversations
- **Priority Inbox** (`/triage`): view priority results + run “Update Priorities”
- **Thread Detail** (`/thread/:threadId`): full thread + **Thread Chat** (draft replies, save to Gmail)
- **Inbox Copilot**: slide‑in panel from Dashboard, with session history

## Key Features

- **Multi‑account support**: switch between multiple Gmail accounts
- **Priority Inbox (Triage)**:
  - Labels: `NEEDS_REPLY`, `FYI`, `ARCHIVE`, `SPAM_LIKE`
  - Priority score \(0–1\), sorted by importance
  - Time filters (Today / 3 / 5 / 7 / 30 days)
  - Pending triage indicator + cooldown based refresh
  - Streaming progress (SSE) and **shared progress state** across Dashboard + `/triage`
- **Inbox Copilot (Assist Chat)**:
  - Saves chat sessions to DB (`assist_chat_sessions`)
  - Tool calling: triage query, RAG search, thread retrieval, draft generation
  - Thread IDs in answers become clickable links in the UI
  - “📖 How to Use This App” quick action
- **Knowledge Base (RAG)**:
  - Local embeddings using `all-MiniLM-L6-v2` (SentenceTransformers)
  - Stored in Postgres + `pgvector` (`email_embeddings`)
  - Background “silent sync & embed” task with cooldown to avoid repeated heavy work
- **Suggested Schedule (Calendar)**:
  - Generates follow‑up blocks from Priority Inbox and places them into free calendar time
  - Week grid view (drag / resize / select) then **Confirm & Create** to write events to Google Calendar

## Project Structure

```
Email-Agent/
├── backend/                         # FastAPI + Python
│   ├── app/
│   │   ├── agents/                  # Assist/Thread/Triage agents + tools
│   │   ├── routes/                  # FastAPI routes
│   │   ├── services/                # Gmail/Calendar/RAG/Embedding/background tasks
│   │   ├── models.py                # SQLAlchemy models
│   │   └── database.py              # DB engine/session
│   ├── init_database.py             # Create tables + add missing indexes (non-destructive)
│   ├── main.py                      # FastAPI entry
│   └── requirements.txt
├── frontend/                        # React
│   ├── src/
│   │   ├── components/
│   │   └── pages/
│   └── package.json
└── client_secret.json               # Google OAuth credentials (gitignored)
```

## Setup (Local Development)

### Prerequisites

- **Python** 3.10+
- **Node.js** 18+
- **PostgreSQL** 15+
- **Google Cloud OAuth** credentials (Gmail + Calendar enabled)

### 1) Backend (FastAPI)

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Create `backend/.env` (example):

```env
PORT=5001
DEBUG=True
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000
SESSION_SECRET=change-me-in-production

# Google OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:5001/api/auth/google/callback

# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=email_agent
DATABASE_USER=postgres
DATABASE_PASSWORD=...

# LLM (choose one)
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=...
# or
# LLM_PROVIDER=openai
# OPENAI_API_KEY=...
```

Initialize DB (creates tables, enables `pgvector`, and adds missing indexes **without wiping data**):

```bash
python init_database.py
```

Run backend:

```bash
python main.py
```

Backend:
- API base: `http://localhost:5001/api`
- Docs: `http://localhost:5001/docs`

### 2) Frontend (React)

```bash
cd frontend
npm install
npm start
```

Optional `frontend/.env`:

```env
REACT_APP_API_URL=http://localhost:5001/api
```

Frontend:
- `http://localhost:3000`

## Google OAuth Setup

In Google Cloud Console:
- Enable **Gmail API** + **Google Calendar API**
- Create OAuth “Web application”
- Add redirect URI: `http://localhost:5001/api/auth/google/callback`

Scopes used (see `backend/app/config.py`):
- `openid`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.compose`
- `https://www.googleapis.com/auth/calendar.events`

## Main API Endpoints (Backend)

### Auth
- `GET /api/auth/google/login`
- `GET /api/auth/google/callback`
- `GET /api/auth/me`
- `POST /api/auth/logout`

### Gmail
- `GET /api/gmail/threads` (supports pagination via `page_token`)
- `GET /api/gmail/threads/{thread_id}`

### Priority Inbox (Triage)
- `POST /api/triage/run` (SSE stream)
- `GET /api/triage/results` (supports `days`, `limit`, `skip`)
- `GET /api/triage/stats` (pending count)

### Thread Chat
- `POST /api/thread-chat/ask` (SSE stream)
- `POST /api/thread-chat/save-draft` (saves to Gmail; auto-detects correct account)

### Inbox Copilot (Assist Chat)
- `POST /api/assist-chat/ask` (SSE stream)
- `GET /api/assist-chat/sessions`
- `GET /api/assist-chat/sessions/{session_id}`
- `DELETE /api/assist-chat/sessions/{session_id}`

### Suggested Schedule (Calendar)
- `GET /api/calendar/suggestions`
- `POST /api/calendar/confirm`

## Production Notes

- Set `DEBUG=False`
- Use a strong `SESSION_SECRET`
- Set `FRONTEND_URL` + `CORS_ORIGINS` to your deployed frontend origin(s)
- Update `GOOGLE_REDIRECT_URI` to your deployed backend callback URL and update OAuth redirect URIs in Google Cloud
- Use a managed Postgres (e.g. Cloud SQL / RDS) and ensure `pgvector` is available
- Use HTTPS in production
