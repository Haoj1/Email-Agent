# Quick Start Guide

## Quick Start Steps

### 1. Backend Setup (Python + FastAPI)

```bash
# Navigate to backend directory
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# macOS/Linux:
source venv/bin/activate
# Windows:
# venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env file (if it doesn't exist)
# Copy the following content to backend/.env:
# PORT=5000
# DEBUG=True
# FRONTEND_URL=http://localhost:3000
# SESSION_SECRET=your-secret-key-change-in-production

# Start the server
python main.py
```

Backend will run on `http://localhost:5000`

### 2. Frontend Setup (React)

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Create .env file (if it doesn't exist)
# Copy the following content to frontend/.env:
# REACT_APP_API_URL=http://localhost:5000/api

# Start the development server
npm start
```

Frontend will run on `http://localhost:3000`

### 3. Test OAuth

1. Open browser and visit `http://localhost:3000`
2. Click "Sign in with Google"
3. Complete Google authorization
4. Test Gmail and Calendar API access on the Dashboard page

## Common Issues

### Backend fails to start

- Check Python version (requires 3.10+)
- Ensure virtual environment is activated
- Check if `client_secret.json` exists
- Check error logs

### OAuth callback fails

- Check if redirect URI in Google Cloud Console matches
- Ensure redirect URI is: `http://localhost:5000/api/auth/google/callback`
- Check if configuration in `client_secret.json` is correct

### Frontend cannot connect to backend

- Ensure backend is running
- Check `REACT_APP_API_URL` in `frontend/.env`
- Check CORS errors in browser console

## Next Steps

After completing OAuth testing, you can start:
1. Database setup (PostgreSQL)
2. Implement LangGraph agents
3. Implement Gmail and Calendar services
