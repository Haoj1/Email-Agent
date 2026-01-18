import json
import os
from pathlib import Path
from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    # Server
    PORT: int = 5001
    DEBUG: bool = True
    NODE_ENV: str = "development"
    FRONTEND_URL: str = "http://localhost:3000"
    
    # CORS (comma-separated string, will be converted to list)
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:3001"
    
    # Session
    SESSION_SECRET: str = "your-secret-key-change-in-production"
    
    # Google OAuth
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:5001/api/auth/google/callback"
    
    # Database (PostgreSQL)
    DATABASE_URL: str = ""
    DATABASE_HOST: str = ""
    DATABASE_PORT: int = 5432
    DATABASE_NAME: str = "email_agent"
    DATABASE_USER: str = "postgres"
    DATABASE_PASSWORD: str = ""
    # For Cloud SQL, use connection name: PROJECT_ID:REGION:INSTANCE_ID
    DATABASE_CONNECTION_NAME: str = ""
    
    # OpenAI API (for LangChain agents)
    OPENAI_API_KEY: str = ""
    
    class Config:
        env_file = ".env"
        case_sensitive = True

# Load settings
settings = Settings()

# Load client_secret.json if exists and settings not provided
if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
    try:
        client_secret_path = Path(__file__).parent.parent.parent / "client_secret.json"
        if client_secret_path.exists():
            with open(client_secret_path, 'r') as f:
                client_secret_data = json.load(f)
                dev_config = client_secret_data.get("dev", {})
                if not settings.GOOGLE_CLIENT_ID:
                    settings.GOOGLE_CLIENT_ID = dev_config.get("client_id", "")
                if not settings.GOOGLE_CLIENT_SECRET:
                    settings.GOOGLE_CLIENT_SECRET = dev_config.get("client_secret", "")
                if not settings.GOOGLE_REDIRECT_URI:
                    redirect_uris = dev_config.get("redirect_uris", [])
                    if redirect_uris:
                        settings.GOOGLE_REDIRECT_URI = redirect_uris[0]
    except Exception as e:
        print(f"Warning: Could not load client_secret.json: {e}")

# Google OAuth Scopes
# Note: 'openid' is automatically added by Google, but we include it explicitly
# to avoid scope validation warnings from oauthlib
GOOGLE_SCOPES = [
    "openid",  # Include explicitly to avoid scope change warnings
    "https://www.googleapis.com/auth/userinfo.email",  # Required to get user email
    "https://www.googleapis.com/auth/userinfo.profile",  # Optional: get user profile info
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/calendar.events"
]

# Validate required config
if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
    print("Warning: Google OAuth credentials are missing!")
    print("Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env or ensure client_secret.json exists")
