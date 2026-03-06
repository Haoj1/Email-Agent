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
    # Local development defaults (override in .env for production)
    DATABASE_URL: str = ""
    DATABASE_HOST: str = "localhost"  # Default to localhost for local development
    DATABASE_PORT: int = 5432
    DATABASE_NAME: str = "email_agent"
    DATABASE_USER: str = "postgres"  # Change to your system username if using peer auth
    DATABASE_PASSWORD: str = ""  # Leave empty if using peer authentication
    # For Cloud SQL, use connection name: PROJECT_ID:REGION:INSTANCE_ID
    DATABASE_CONNECTION_NAME: str = ""
    
    # LLM API Configuration (for LangChain agents)
    # DeepSeek (recommended for cost efficiency)
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com/v1"
    DEEPSEEK_MODEL: str = "deepseek-chat"  # deepseek-chat (V3) or deepseek-reasoner (R1)
    
    # OpenAI API (optional, as fallback)
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"  # gpt-4o-mini, gpt-4o, etc.
    
    # LLM Provider Selection
    LLM_PROVIDER: str = "deepseek"  # "deepseek" or "openai"
    
    # Web search (free DuckDuckGo via ddgs; no API key)
    ENABLE_WEB_SEARCH: bool = True  # Set False to disable web search tool in Inbox Copilot
    WEB_SEARCH_MAX_RESULTS: int = 5  # Max results per query
    
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
