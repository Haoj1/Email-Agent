import os
# Allow insecure transport in development (localhost only)
# This MUST be set before importing oauthlib-related modules
# This is required for OAuth2 to work with HTTP in local development
# We'll check the environment after importing settings
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'  # Set by default for development

from fastapi import APIRouter, Request, HTTPException, Depends, Query, BackgroundTasks
from fastapi.responses import RedirectResponse, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from datetime import datetime, timezone
from typing import Optional
import httpx
import re
from app.config import settings, GOOGLE_SCOPES
from app.database import get_db
from app.models import User, UserEmail, OAuthToken
from app.services.background_tasks import sync_and_embed_emails

# In production, remove the insecure transport setting
# For now, we keep it enabled for local development
if settings.NODE_ENV == "production":
    os.environ.pop('OAUTHLIB_INSECURE_TRANSPORT', None)

router = APIRouter()

# In-memory session storage (will be replaced with database later)
# Format: {session_id: {email: str, tokens: dict}}
user_sessions = {}

def get_session_id(request: Request) -> str:
    """Get or create session ID from cookie"""
    session_id = request.cookies.get("session_id")
    if not session_id:
        import secrets
        session_id = secrets.token_urlsafe(32)
    return session_id

@router.get("/google/login")
async def google_login(
    action: Optional[str] = Query(None, description="Action: 'login' or 'add_email'"),
    user_id: Optional[int] = Query(None, description="User ID (required for add_email)")
):
    """
    Initiate Google OAuth login flow
    
    - action='login': Normal login (create new user or login existing)
    - action='add_email': Add email to existing user (requires user_id)
    """
    try:
        if action == "add_email" and not user_id:
            raise HTTPException(status_code=400, detail="user_id is required for add_email action")
        
        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [settings.GOOGLE_REDIRECT_URI]
                }
            },
            scopes=GOOGLE_SCOPES
        )
        flow.redirect_uri = settings.GOOGLE_REDIRECT_URI
        
        # Include action and user_id in state for callback
        state_data = {"action": action or "login"}
        if user_id:
            state_data["user_id"] = user_id
        
        import json
        import base64
        state_encoded = base64.b64encode(json.dumps(state_data).encode()).decode()
        
        authorization_url, _ = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent',  # Force consent screen to get refresh token
            state=state_encoded
        )
        
        return {"authUrl": authorization_url, "state": state_encoded}
    except Exception as e:
        print(f"Error generating auth URL: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate auth URL: {str(e)}")

@router.get("/google/callback")
async def google_callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Handle Google OAuth callback
    Supports both login and add_email actions
    """
    if not code:
        error = request.query_params.get("error", "Authorization code not provided")
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/auth/callback?success=false&error={error}"
        )
    
    # Parse state to get action and user_id
    action = "login"
    user_id = None
    if state:
        try:
            import json
            import base64
            state_data = json.loads(base64.b64decode(state).decode())
            action = state_data.get("action", "login")
            user_id = state_data.get("user_id")
        except Exception as e:
            print(f"Error parsing state: {e}, defaulting to login")
    
    try:
        print(f"Starting OAuth callback with code: {code[:20]}...")
        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [settings.GOOGLE_REDIRECT_URI]
                }
            },
            scopes=GOOGLE_SCOPES
        )
        flow.redirect_uri = settings.GOOGLE_REDIRECT_URI
        
        # Exchange code for tokens
        # Use code parameter directly to avoid scope validation issues
        print("Fetching token...")
        print(f"Using authorization code: {code[:20]}...")
        
        # Fetch token using code directly - this avoids scope validation warnings
        # Google may add 'openid' scope automatically, which is fine
        import warnings
        with warnings.catch_warnings():
            # Suppress warnings during token fetch
            warnings.simplefilter("ignore")
            try:
                # Use code parameter directly instead of full URL
                flow.fetch_token(code=code)
            except Exception as e:
                # If that fails, try with full URL
                print(f"Direct code fetch failed: {e}, trying with full URL...")
                authorization_response = str(request.url)
                flow.fetch_token(authorization_response=authorization_response)
        
        # Get credentials
        try:
            credentials = flow.credentials
        except (ValueError, AttributeError) as e:
            # If credentials property fails, try to get token directly from oauth2session
            print(f"Credentials property failed: {e}, trying to get token from oauth2session...")
            if hasattr(flow, 'oauth2session') and hasattr(flow.oauth2session, 'token'):
                token_data = flow.oauth2session.token
                if token_data and 'access_token' in token_data:
                    print("Found token in oauth2session, constructing credentials...")
                    # Parse scope from token data
                    scope_str = token_data.get('scope', '')
                    if isinstance(scope_str, str):
                        scopes = scope_str.split() if scope_str else []
                    else:
                        scopes = scope_str if isinstance(scope_str, list) else []
                    
                    credentials = Credentials(
                        token=token_data.get('access_token'),
                        refresh_token=token_data.get('refresh_token'),
                        token_uri=flow.client_config.get('token_uri', 'https://oauth2.googleapis.com/token'),
                        client_id=settings.GOOGLE_CLIENT_ID,
                        client_secret=settings.GOOGLE_CLIENT_SECRET,
                        scopes=scopes
                    )
                else:
                    raise HTTPException(
                        status_code=500,
                        detail="Failed to obtain access token: token not found in oauth2session"
                    )
            else:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to get credentials: {str(e)}"
                )
        
        # Verify credentials are valid
        if not credentials or not credentials.token:
            raise HTTPException(
                status_code=400,
                detail="Failed to obtain access token"
            )
        
        print(f"Token obtained: {credentials.token[:30] if credentials.token else 'None'}...")
        print(f"Token scopes: {credentials.scopes}")
        print(f"Token expired: {credentials.expired if hasattr(credentials, 'expired') else 'N/A'}")
        
        # Get user info using the token via HTTP request
        # Use async HTTP client to avoid blocking
        print("Fetching user info from Google...")
        async with httpx.AsyncClient() as client:
            headers = {'Authorization': f'Bearer {credentials.token}'}
            user_info_response = await client.get(
                'https://www.googleapis.com/oauth2/v2/userinfo',
                headers=headers
            )
            
            print(f"User info response status: {user_info_response.status_code}")
            if user_info_response.status_code != 200:
                error_text = user_info_response.text
                print(f"User info error response: {error_text}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to get user info. Make sure 'userinfo.email' scope is included. Error: {error_text}"
                )
            
            user_info = user_info_response.json()
            user_email = user_info.get('email')
            print(f"User email obtained: {user_email}")
        
        if not user_email:
            raise HTTPException(
                status_code=500,
                detail="Failed to get user email from Google"
            )
        
        # Handle based on action
        if action == "add_email" and user_id:
            # Add email to existing user
            return await handle_add_email(db, user_id, user_email, credentials, request)
        else:
            # Login or create new user
            return await handle_login(db, user_email, credentials, request)
        
    except HTTPException as e:
        # HTTPException should be re-raised, not caught
        print(f"HTTPException in OAuth callback: {e.status_code} - {e.detail}")
        error_msg = e.detail if e.detail else f"HTTP {e.status_code} error"
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/auth/callback?success=false&error={error_msg}"
        )
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"Error in OAuth callback: {type(e).__name__}: {str(e)}")
        print(f"Traceback: {error_trace}")
        error_msg = str(e) if str(e) else f"{type(e).__name__} occurred"
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/auth/callback?success=false&error={error_msg}"
        )

@router.get("/me")
async def get_current_user(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """Get current authenticated user from database"""
    session_id = request.cookies.get("session_id")
    if not session_id or session_id not in user_sessions:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    user_data = user_sessions[session_id]
    user_id = user_data.get("user_id")
    
    if user_id:
        # Get user from database with emails
        user = await db.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Trigger background sync and embedding for the user
        background_tasks.add_task(sync_and_embed_emails, user_id)
        
        # Get all emails for user
        result = await db.execute(
            select(UserEmail).where(UserEmail.user_id == user_id)
        )
        emails = result.scalars().all()
        
        primary_email_obj = next((e for e in emails if e.is_primary), None)
        
        return {
            "user_id": user.id,
            "email": user_data.get("email"),
            "primary_email": user.primary_email,
            "emails": [
                {
                    "id": e.id,
                    "email": e.email,
                    "is_primary": e.is_primary,
                    "verified": e.verified
                }
                for e in emails
            ],
            "authenticated": True
        }
    else:
        # Fallback to session data
        return {
            "email": user_data.get("email"),
            "authenticated": True
        }

@router.post("/logout")
async def logout(request: Request):
    """Logout current user"""
    session_id = request.cookies.get("session_id")
    if session_id and session_id in user_sessions:
        del user_sessions[session_id]
    
    response = JSONResponse({"message": "Logged out successfully"})
    response.delete_cookie("session_id")
    return response


async def get_current_user_id(
    request: Request,
    db: AsyncSession = Depends(get_db)
) -> int:
    """
    Dependency function to get current authenticated user ID
    Used by other routes that need user_id (e.g., triage.py)
    """
    user = await get_current_user(request, db)
    return user["user_id"]


async def get_user_credentials(
    request: Request,
    email: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
) -> Credentials:
    """
    Get user credentials from database.
    If email is provided, use that email's token. Otherwise use primary email.
    """
    session_id = request.cookies.get("session_id")
    if not session_id or session_id not in user_sessions:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    user_data = user_sessions[session_id]
    user_id = user_data.get("user_id")
    
    if not user_id:
        # Fallback to session-based auth (legacy)
        tokens = user_data.get("tokens", {})
        if not tokens:
            raise HTTPException(status_code=401, detail="No credentials found")
        
        credentials = Credentials(
            token=tokens.get("token"),
            refresh_token=tokens.get("refresh_token"),
            token_uri=tokens.get("token_uri"),
            client_id=tokens.get("client_id"),
            client_secret=tokens.get("client_secret"),
            scopes=tokens.get("scopes")
        )
        
        if credentials.expired and credentials.refresh_token:
            credentials.refresh(GoogleRequest())
            user_sessions[session_id]["tokens"]["token"] = credentials.token
        
        return credentials
    
    # Get token from database
    if email:
        # Find specific email
        result = await db.execute(
            select(UserEmail).where(
                UserEmail.user_id == user_id,
                UserEmail.email == email
            )
        )
        user_email_obj = result.scalar_one_or_none()
    else:
        # Use primary email
        result = await db.execute(
            select(UserEmail).where(
                UserEmail.user_id == user_id,
                UserEmail.is_primary == True
            )
        )
        user_email_obj = result.scalar_one_or_none()
    
    if not user_email_obj:
        raise HTTPException(status_code=404, detail="Email not found")
    
    # Get OAuth token
    result = await db.execute(
        select(OAuthToken).where(
            OAuthToken.user_email_id == user_email_obj.id
        )
    )
    oauth_token = result.scalar_one_or_none()
    
    if not oauth_token:
        raise HTTPException(status_code=404, detail="OAuth token not found")
    
    # Build credentials
    scopes = oauth_token.scope.split() if oauth_token.scope else []
    credentials = Credentials(
        token=oauth_token.access_token,
        refresh_token=oauth_token.refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=scopes
    )
    
    # Refresh token if expired
    if credentials.expired and credentials.refresh_token:
        credentials.refresh(GoogleRequest())
        # Update token in database
        oauth_token.access_token = credentials.token
        if hasattr(credentials, 'expiry') and credentials.expiry:
            oauth_token.expires_at = credentials.expiry
        oauth_token.updated_at = datetime.now(timezone.utc)
        await db.commit()
    
    return credentials

@router.get("/test/gmail")
async def test_gmail(
    request: Request,
    email: Optional[str] = Query(None, description="Email to use (default: primary)"),
    db: AsyncSession = Depends(get_db)
):
    """Test Gmail API access and return email details"""
    try:
        credentials = await get_user_credentials(request, email, db)
        service = build('gmail', 'v1', credentials=credentials)
        result = service.users().messages().list(userId='me', maxResults=10).execute()
        
        messages = result.get('messages', [])
        message_details = []
        
        # Get detailed information for each message
        for msg in messages[:10]:  # Limit to 10 messages
            try:
                msg_detail = service.users().messages().get(
                    userId='me',
                    id=msg['id'],
                    format='metadata',
                    metadataHeaders=['From', 'Subject', 'Date']
                ).execute()
                
                headers = msg_detail.get('payload', {}).get('headers', [])
                from_header = next((h['value'] for h in headers if h['name'] == 'From'), 'Unknown')
                subject_header = next((h['value'] for h in headers if h['name'] == 'Subject'), '(No Subject)')
                date_header = next((h['value'] for h in headers if h['name'] == 'Date'), 'Unknown')
                
                message_details.append({
                    "id": msg['id'],
                    "threadId": msg.get('threadId'),
                    "from": from_header,
                    "subject": subject_header,
                    "date": date_header,
                    "snippet": msg_detail.get('snippet', ''),
                    "labelIds": msg_detail.get('labelIds', [])
                })
            except Exception as e:
                print(f"Error getting message {msg.get('id')}: {e}")
                message_details.append({
                    "id": msg.get('id'),
                    "error": str(e)
                })
        
        return {
            "success": True,
            "messageCount": len(messages),
            "totalMessages": result.get('resultSizeEstimate', 0),
            "messages": message_details
        }
    except Exception as e:
        error_str = str(e)
        print(f"Error testing Gmail API: {e}")
        
        # Check if it's an API not enabled error
        if "has not been used" in error_str or "is disabled" in error_str or "accessNotConfigured" in error_str:
            # Extract project ID if available
            project_match = re.search(r'project (\d+)', error_str)
            project_id = project_match.group(1) if project_match else "your-project"
            
            error_detail = (
                "Gmail API is not enabled in your Google Cloud project. "
                f"Please enable it at: https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project={project_id} "
                "After enabling, wait a few minutes for the changes to propagate."
            )
            raise HTTPException(
                status_code=403,
                detail=error_detail
            )
        else:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to access Gmail API: {error_str}"
            )

@router.get("/test/calendar")
async def test_calendar(
    request: Request,
    email: Optional[str] = Query(None, description="Email to use (default: primary)"),
    db: AsyncSession = Depends(get_db)
):
    """Test Calendar API access"""
    try:
        credentials = await get_user_credentials(request, email, db)
        service = build('calendar', 'v3', credentials=credentials)
        now = datetime.now().isoformat() + 'Z'
        result = service.events().list(
            calendarId='primary',
            maxResults=5,
            timeMin=now
        ).execute()
        
        events = result.get('items', [])
        return {
            "success": True,
            "eventCount": len(events),
            "events": events
        }
    except Exception as e:
        error_str = str(e)
        print(f"Error testing Calendar API: {e}")
        
        # Check if it's an API not enabled error
        if "has not been used" in error_str or "is disabled" in error_str or "accessNotConfigured" in error_str:
            # Extract project ID if available
            project_match = re.search(r'project (\d+)', error_str)
            project_id = project_match.group(1) if project_match else "your-project"
            
            error_detail = (
                "Calendar API is not enabled in your Google Cloud project. "
                f"Please enable it at: https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project={project_id} "
                "After enabling, wait a few minutes for the changes to propagate."
            )
            raise HTTPException(
                status_code=403,
                detail=error_detail
            )
        else:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to access Calendar API: {error_str}"
            )


# Helper functions for OAuth callback
async def handle_login(
    db: AsyncSession,
    user_email: str,
    credentials: Credentials,
    request: Request
) -> RedirectResponse:
    """Handle login: create user if new, or login existing user"""
    # Check if email already exists
    result = await db.execute(
        select(UserEmail).where(UserEmail.email == user_email)
    )
    existing_email = result.scalar_one_or_none()
    
    if existing_email:
        # User exists, login
        user = await db.get(User, existing_email.user_id)
        user_email_obj = existing_email
    else:
        # Create new user
        user = User(
            primary_email=user_email,
            timezone=None
        )
        db.add(user)
        await db.flush()  # Get user.id
        
        # Create user_email
        user_email_obj = UserEmail(
            user_id=user.id,
            email=user_email,
            is_primary=True,
            verified=True
        )
        db.add(user_email_obj)
        await db.flush()  # Get user_email_obj.id
    
    # Check if OAuth token already exists for this email
    result = await db.execute(
        select(OAuthToken).where(
            OAuthToken.user_email_id == user_email_obj.id
        )
    )
    existing_token = result.scalar_one_or_none()
    
    # Calculate expires_at
    expires_at = None
    if hasattr(credentials, 'expiry') and credentials.expiry:
        expires_at = credentials.expiry
    
    if existing_token:
        # Update existing token
        existing_token.access_token = credentials.token
        existing_token.refresh_token = credentials.refresh_token
        existing_token.expires_at = expires_at
        existing_token.scope = ' '.join(credentials.scopes) if credentials.scopes else None
        existing_token.updated_at = datetime.now(timezone.utc)
    else:
        # Create new token
        oauth_token = OAuthToken(
            user_id=user.id,
            user_email_id=user_email_obj.id,
            provider="google",
            access_token=credentials.token,
            refresh_token=credentials.refresh_token,
            expires_at=expires_at,
            scope=' '.join(credentials.scopes) if credentials.scopes else None
        )
        db.add(oauth_token)
    
    await db.commit()
    
    # Store user_id in session (for backward compatibility with existing session system)
    session_id = get_session_id(request)
    user_sessions[session_id] = {
        "user_id": user.id,
        "email": user_email,
        "primary_email": user.primary_email
    }
    
    # Redirect to frontend
    response = RedirectResponse(
        url=f"{settings.FRONTEND_URL}/auth/callback?success=true&email={user_email}&user_id={user.id}"
    )
    response.set_cookie(
        key="session_id",
        value=session_id,
        httponly=True,
        secure=settings.NODE_ENV == "production",
        samesite="lax",
        max_age=86400  # 24 hours
    )
    return response


async def handle_add_email(
    db: AsyncSession,
    user_id: int,
    user_email: str,
    credentials: Credentials,
    request: Request
) -> RedirectResponse:
    """Handle adding a new email to existing user"""
    # Verify user exists
    user = await db.get(User, user_id)
    if not user:
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/auth/callback?success=false&error=User not found"
        )
    
    # Check if email already exists for this user
    result = await db.execute(
        select(UserEmail).where(
            UserEmail.user_id == user_id,
            UserEmail.email == user_email
        )
    )
    existing_email = result.scalar_one_or_none()
    
    if existing_email:
        # Email already exists, update token
        user_email_obj = existing_email
    else:
        # Create new user_email
        user_email_obj = UserEmail(
            user_id=user_id,
            email=user_email,
            is_primary=False,  # New email is not primary by default
            verified=True
        )
        db.add(user_email_obj)
        await db.flush()
    
    # Check if token exists
    result = await db.execute(
        select(OAuthToken).where(
            OAuthToken.user_email_id == user_email_obj.id
        )
    )
    existing_token = result.scalar_one_or_none()
    
    # Calculate expires_at
    expires_at = None
    if hasattr(credentials, 'expiry') and credentials.expiry:
        expires_at = credentials.expiry
    
    if existing_token:
        # Update existing token
        existing_token.access_token = credentials.token
        existing_token.refresh_token = credentials.refresh_token
        existing_token.expires_at = expires_at
        existing_token.scope = ' '.join(credentials.scopes) if credentials.scopes else None
        existing_token.updated_at = datetime.now(timezone.utc)
    else:
        # Create new token
        oauth_token = OAuthToken(
            user_id=user_id,
            user_email_id=user_email_obj.id,
            provider="google",
            access_token=credentials.token,
            refresh_token=credentials.refresh_token,
            expires_at=expires_at,
            scope=' '.join(credentials.scopes) if credentials.scopes else None
        )
        db.add(oauth_token)
    
    await db.commit()
    
    # Redirect to frontend
    return RedirectResponse(
        url=f"{settings.FRONTEND_URL}/auth/callback?success=true&action=add_email&email={user_email}&user_id={user_id}"
    )
