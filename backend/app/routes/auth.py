import os
# Allow insecure transport in development (localhost only)
# This MUST be set before importing oauthlib-related modules
# This is required for OAuth2 to work with HTTP in local development
# We'll check the environment after importing settings
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'  # Set by default for development

from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import RedirectResponse, JSONResponse
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from datetime import datetime
from typing import Optional
import httpx
import re
from app.config import settings, GOOGLE_SCOPES

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
async def google_login():
    """Initiate Google OAuth login flow"""
    try:
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
        
        authorization_url, state = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent'  # Force consent screen to get refresh token
        )
        
        return {"authUrl": authorization_url, "state": state}
    except Exception as e:
        print(f"Error generating auth URL: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate auth URL: {str(e)}")

@router.get("/google/callback")
async def google_callback(request: Request, code: Optional[str] = None, state: Optional[str] = None):
    """Handle Google OAuth callback"""
    if not code:
        error = request.query_params.get("error", "Authorization code not provided")
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/auth/callback?success=false&error={error}"
        )
    
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
        
        # Store tokens in session
        session_id = get_session_id(request)
        user_sessions[session_id] = {
            "email": user_email,
            "tokens": {
                "token": credentials.token,
                "refresh_token": credentials.refresh_token,
                "token_uri": credentials.token_uri,
                "client_id": credentials.client_id,
                "client_secret": credentials.client_secret,
                "scopes": credentials.scopes
            }
        }
        
        # Redirect to frontend with success
        response = RedirectResponse(
            url=f"{settings.FRONTEND_URL}/auth/callback?success=true&email={user_email}"
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
async def get_current_user(request: Request):
    """Get current authenticated user"""
    session_id = request.cookies.get("session_id")
    if not session_id or session_id not in user_sessions:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    user_data = user_sessions[session_id]
    return {
        "email": user_data["email"],
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

def get_user_credentials(request: Request) -> Credentials:
    """Get user credentials from session"""
    session_id = request.cookies.get("session_id")
    if not session_id or session_id not in user_sessions:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    user_data = user_sessions[session_id]
    tokens = user_data["tokens"]
    
    credentials = Credentials(
        token=tokens.get("token"),
        refresh_token=tokens.get("refresh_token"),
        token_uri=tokens.get("token_uri"),
        client_id=tokens.get("client_id"),
        client_secret=tokens.get("client_secret"),
        scopes=tokens.get("scopes")
    )
    
    # Refresh token if expired
    if credentials.expired and credentials.refresh_token:
        credentials.refresh(GoogleRequest())
        # Update session with new token
        user_sessions[session_id]["tokens"]["token"] = credentials.token
    
    return credentials

@router.get("/test/gmail")
async def test_gmail(credentials: Credentials = Depends(get_user_credentials)):
    """Test Gmail API access and return email details"""
    try:
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
async def test_calendar(credentials: Credentials = Depends(get_user_credentials)):
    """Test Calendar API access"""
    try:
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
