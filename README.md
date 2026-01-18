# Multi-User AI Email Agent

A multi-user AI Email Agent Web application based on Gmail + Google Calendar, with LangGraph implementation for email analysis, reply draft generation, calendar event extraction, a Cursor-style executable Thread Chat Agent, and a global Assist Chat Agent (similar to Google Gemini).

## Project Structure

```
Email-Agent/
├── backend/              # FastAPI + Python backend
│   ├── app/
│   │   ├── config.py    # Configuration
│   │   ├── routes/      # API routes
│   │   ├── agents/      # LangGraph agents (to be implemented)
│   │   └── services/    # Service layer (Gmail, Calendar)
│   ├── main.py          # FastAPI application
│   └── requirements.txt # Python dependencies
├── frontend/            # React frontend
│   ├── src/
│   │   ├── pages/       # Page components
│   │   └── services/    # API services
│   └── public/
├── client_secret.json   # Google OAuth credentials (gitignored)
└── prd.md              # Product requirements document
```

## Setup Instructions

### Prerequisites

- Python 3.10 or higher
- Node.js (v18 or higher)
- npm or yarn
- Google Cloud Project with OAuth credentials

### Backend Setup (FastAPI + Python)

1. Navigate to backend directory:
```bash
cd backend
```

2. Create virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Create `.env` file:
```bash
# Copy the example (if .env.example exists)
cp .env.example .env
```

5. Update `.env` with your configuration:
```env
PORT=5000
DEBUG=True
FRONTEND_URL=http://localhost:3000
SESSION_SECRET=your-secret-key-change-in-production
```

6. Ensure `client_secret.json` is in the project root with your Google OAuth credentials.

7. Start the server:
```bash
python main.py
```

Or with uvicorn:
```bash
uvicorn main:app --reload --port 5000
```

The backend will run on `http://localhost:5000`
API documentation: `http://localhost:5000/docs`

### Frontend Setup (React)

1. Navigate to frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file:
```bash
# Copy the example (if .env.example exists)
cp .env.example .env
```

4. Update `.env` if needed:
```env
REACT_APP_API_URL=http://localhost:5000/api
```

5. Start the development server:
```bash
npm start
```

The frontend will run on `http://localhost:3000`

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable Gmail API and Calendar API
4. Create OAuth 2.0 credentials (Web application)
5. Add authorized redirect URI: `http://localhost:5000/api/auth/google/callback`
6. Download credentials and save as `client_secret.json` in the project root

### Required OAuth Scopes

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.compose`
- `https://www.googleapis.com/auth/calendar.events`

## Current Features

- ✅ Google OAuth authentication (FastAPI)
- ✅ Gmail API access test
- ✅ Calendar API access test
- ✅ Session management
- ✅ Multi-user support (session-based)
- ✅ LangGraph dependencies installed
- ✅ Service layer structure (Gmail, Calendar)
- ✅ Email display with details (subject, from, date, snippet)

## Next Steps

- [ ] Database setup (PostgreSQL)
- [ ] Token storage in database
- [ ] LangGraph agent implementation
  - [ ] Email triage agent
  - [ ] Thread chat agent
  - [ ] Assist chat agent (global AI assistant)
  - [ ] Draft generation agent
  - [ ] Calendar event extraction
- [ ] Inbox sync functionality
- [ ] Gmail service implementation
- [ ] Calendar service implementation

## API Endpoints

### Authentication
- `GET /api/auth/google/login` - Initiate Google OAuth login
- `GET /api/auth/google/callback` - OAuth callback handler
- `GET /api/auth/me` - Get current authenticated user
- `POST /api/auth/logout` - Logout current user

### Testing
- `GET /api/auth/test/gmail` - Test Gmail API access
- `GET /api/auth/test/calendar` - Test Calendar API access

### Gmail
- `POST /api/gmail/sync` - Sync inbox (to be implemented)
- `GET /api/threads/{thread_id}` - Get email thread (to be implemented)

### Thread Chat Agent
- `POST /api/chat/thread` - Thread Chat Agent conversation (to be implemented)
- `POST /api/chat/confirm` - Confirm and execute action (to be implemented)

### Assist Chat Agent
- `POST /api/chat/assist` - Assist Chat Agent conversation (to be implemented)
- `POST /api/chat/assist/confirm` - Confirm and execute action (to be implemented)
- `GET /api/chat/assist/history` - Get conversation history (to be implemented)

### Calendar
- `POST /api/calendar/events` - Create calendar event (to be implemented)

### Drafts
- `POST /api/drafts/save` - Save email draft (to be implemented)

### Health
- `GET /api/health` - Health check endpoint

## Technology Stack

### Backend
- **FastAPI** - Modern Python web framework
- **Google APIs** - Gmail and Calendar integration
- **LangGraph** - Agent orchestration framework
- **LangChain** - LLM framework
- **Pydantic** - Data validation

### Frontend
- **React** - UI framework
- **React Router** - Routing
- **Axios** - HTTP client

## Security Notes

- Never commit `client_secret.json` or `.env` files
- Use strong `SESSION_SECRET` in production
- Enable HTTPS in production
- All write operations require user confirmation (human-in-the-loop)
- OAuth tokens are stored securely (currently in-memory, will be in database)

## Development

### Backend Development

The backend uses FastAPI with automatic API documentation:
- Swagger UI: `http://localhost:5000/docs`
- ReDoc: `http://localhost:5000/redoc`

### Adding New Routes

1. Create route file in `app/routes/`
2. Import and include in `main.py`

### Adding LangGraph Agents

1. Create agent file in `app/agents/`
2. Implement using LangGraph framework
3. Add routes in `app/routes/` to expose agent endpoints

#### Agent Types

- **Thread Chat Agent**: Context-aware agent for specific email threads
- **Assist Chat Agent**: Global AI assistant (similar to Gemini) that can be opened anywhere in the app

## License

ISC
