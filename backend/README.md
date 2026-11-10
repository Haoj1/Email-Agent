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

## Sync and release

Production enables server-side Gmail sync so connected accounts update while the browser is closed. Set `MAILBOX_SYNC_ENABLED=false` to use browser-triggered sync. Each account gets its own Gmail history cursor. Sync runs every five minutes by default and catches up in pages. Set `MAILBOX_EMBEDDINGS_ENABLED=false` on memory-constrained hosts to disable background vector indexing. The rules-based follow-up queue and Gmail keyword search still work.

Production requires a unique random `SESSION_SECRET` of at least 32 characters. Existing logins need to sign in once after upgrading to database-backed sessions. Legacy vectors without a mailbox ID stay out of search until the corresponding conversations are reindexed.

GitHub Actions builds the frontend and tests additive migrations, mailbox workflows, and rollback against a disposable PostgreSQL database with pgvector. On a Linux deployment host, stage each version in `APP_ROOT/releases/<version>` with the backend dependencies installed in `backend/.venv`. Load the service's environment for the release command. Configure its systemd unit to start from `APP_ROOT/current/backend` and give the deploy runner permission to restart that unit. Then run `scripts/activate-release.sh <release-directory>` with `APP_ROOT`, `SERVICE_NAME`, `READY_URL`, and a free localhost `CANDIDATE_PORT`. The script migrates, checks the staged API locally, switches the release symlink, and restores the prior release if activation fails. For a pre-upgrade release that lacks `/api/ready`, set `ROLLBACK_HEALTH_URL` to its `/api/health` endpoint.

### cs320 release

The GitHub release workflow runs verification on `main`, builds the frontend against `https://api.mail-agents.net/api`, and sends one versioned frontend/backend bundle over a dedicated SSH key. The receiver stages the bundle, creates the Python environment, migrates the database, and checks readiness before switching `/srv/email-agent/current`. Nginx serves the current frontend and proxies the API to the loopback-only service. Previous release directories remain available for rollback.

The cs320 service uses the `email_agent` OS user and PostgreSQL peer authentication over `/run/postgresql-email-agent`. Set production credentials in `/etc/email-agent/backend.env`. Set `MAILBOX_EMBEDDINGS_ENABLED=true` and install `requirements-embeddings.txt` when enabling semantic search.
