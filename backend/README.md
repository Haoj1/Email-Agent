# Email Agent Backend

FastAPI backend for Multi-User AI Email Agent with LangGraph integration.

## Setup

### Prerequisites

- Python 3.10 or higher
- pip or poetry

### Installation

1. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Create `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

4. Update `.env` with your configuration:
```env
PORT=5000
DEBUG=True
FRONTEND_URL=http://localhost:3000
SESSION_SECRET=your-secret-key-change-in-production
```

5. Ensure `client_secret.json` is in the project root with your Google OAuth credentials.

### Running the Server

Development mode (with auto-reload):
```bash
python main.py
```

Or using uvicorn directly:
```bash
uvicorn main:app --reload --port 5000
```

The API will be available at `http://localhost:5000`

API documentation (Swagger UI) will be available at `http://localhost:5000/docs`

## Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── config.py           # Configuration settings
│   ├── routes/             # API routes
│   │   ├── auth.py         # OAuth routes
│   │   └── health.py       # Health check
│   ├── agents/             # LangGraph agents (to be implemented)
│   └── services/           # Service layer
│       ├── gmail_service.py
│       └── calendar_service.py
├── main.py                 # FastAPI application entry point
├── requirements.txt        # Python dependencies
└── .env.example           # Environment variables template
```

## API Endpoints

### Authentication
- `GET /api/auth/google/login` - Initiate Google OAuth login
- `GET /api/auth/google/callback` - OAuth callback handler
- `GET /api/auth/me` - Get current authenticated user
- `POST /api/auth/logout` - Logout current user

### Testing
- `GET /api/auth/test/gmail` - Test Gmail API access
- `GET /api/auth/test/calendar` - Test Calendar API access

### Health
- `GET /api/health` - Health check endpoint

## Next Steps

- [ ] Database setup (PostgreSQL)
- [ ] Token storage in database
- [ ] LangGraph agent implementation
- [ ] Gmail service implementation
- [ ] Calendar service implementation
- [ ] Thread chat agent
- [ ] Email triage agent

## Development Notes

- Session storage is currently in-memory (will be replaced with database)
- OAuth tokens are stored in session (will be persisted to database)
- LangGraph agents will be implemented in `app/agents/` directory
