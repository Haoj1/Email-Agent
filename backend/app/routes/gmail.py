"""
Gmail API routes - email query and management
"""
from fastapi import APIRouter, HTTPException, Depends, Query, Request, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from typing import Optional, List
from datetime import datetime, timedelta
from pydantic import BaseModel
from app.database import get_db
from app.routes.auth import get_user_credentials, get_current_user_id
from app.services.gmail_service import GmailService
from app.models import UserEmail

router = APIRouter()


class SyncRequest(BaseModel):
    """Request model for inbox sync"""
    max_results: Optional[int] = 100
    days: Optional[int] = 30
    email: Optional[str] = None


@router.get("/gmail/threads")
async def get_email_threads(
    request: Request,
    max_results: int = Query(30, ge=1, le=100, description="Maximum number of threads"),
    days: int = Query(7, ge=1, le=30, description="Number of days to look back"),
    email: Optional[str] = Query(None, description="Email to use (default: primary)"),
    page_token: Optional[str] = Query(None, description="Page token for pagination"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get email threads from inbox
    
    Returns list of email threads with basic information and pagination token
    """
    try:
        # Get credentials
        credentials = await get_user_credentials(request, email, db)
        service = build('gmail', 'v1', credentials=credentials)
        
        # Calculate date filter
        after_date = (datetime.now() - timedelta(days=days)).strftime('%Y/%m/%d')
        query = f'after:{after_date}'
        
        # Get threads
        list_params = {
            "userId": 'me',
            "maxResults": max_results,
            "q": query
        }
        if page_token:
            list_params["pageToken"] = page_token
            
        result = service.users().threads().list(**list_params).execute()
        
        threads = result.get('threads', [])
        next_page_token = result.get('nextPageToken')
        thread_list = []
        
        # Get detailed information for each thread
        for thread in threads:
            try:
                thread_detail = service.users().threads().get(
                    userId='me',
                    id=thread['id'],
                    format='metadata',
                    metadataHeaders=['From', 'Subject', 'Date', 'To']
                ).execute()
                
                messages = thread_detail.get('messages', [])
                if not messages:
                    continue
                
                # Get the latest message
                latest_message = messages[-1]
                headers = latest_message.get('payload', {}).get('headers', [])
                
                from_header = next((h['value'] for h in headers if h['name'] == 'From'), 'Unknown')
                subject_header = next((h['value'] for h in headers if h['name'] == 'Subject'), '(No Subject)')
                date_header = next((h['value'] for h in headers if h['name'] == 'Date'), 'Unknown')
                to_header = next((h['value'] for h in headers if h['name'] == 'To'), 'Unknown')
                
                thread_list.append({
                    "thread_id": thread['id'],
                    "from": from_header,
                    "to": to_header,
                    "subject": subject_header,
                    "date": date_header,
                    "snippet": latest_message.get('snippet', ''),
                    "message_count": len(messages),
                    "label_ids": latest_message.get('labelIds', [])
                })
            except Exception as e:
                print(f"Error getting thread {thread.get('id')}: {e}")
                continue
        
        return {
            "success": True,
            "thread_count": len(thread_list),
            "total_estimated": result.get('resultSizeEstimate', 0),
            "threads": thread_list,
            "next_page_token": next_page_token
        }
    except Exception as e:
        error_str = str(e)
        print(f"Error getting email threads: {e}")
        
        if "has not been used" in error_str or "is disabled" in error_str:
            raise HTTPException(
                status_code=403,
                detail="Gmail API is not enabled. Please enable it in Google Cloud Console."
            )
        else:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to get email threads: {error_str}"
            )


@router.get("/gmail/threads/{thread_id}")
async def get_thread_detail(
    thread_id: str,
    request: Request,
    email: Optional[str] = Query(None, description="Email to use (default: primary)"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get detailed information about a specific email thread.
    If thread is not found with the specified email, tries all user's email accounts.
    """
    user_id = await get_current_user_id(request, db)
    
    # Get all user's email accounts
    result = await db.execute(
        select(UserEmail).where(UserEmail.user_id == user_id)
    )
    user_emails = result.scalars().all()
    
    if not user_emails:
        raise HTTPException(status_code=404, detail="No email accounts found")
    
    # Sort emails: specified email first, then primary, then others
    email_list = []
    if email:
        for ue in user_emails:
            if ue.email == email:
                email_list.insert(0, ue.email)
            elif ue.is_primary and email not in email_list:
                email_list.append(ue.email)
            elif ue.email not in email_list:
                email_list.append(ue.email)
    else:
        # Primary first, then others
        for ue in user_emails:
            if ue.is_primary:
                email_list.insert(0, ue.email)
            else:
                email_list.append(ue.email)
    
    # Try each email account until we find the thread
    last_error = None
    for email_account in email_list:
        try:
            # Get credentials for this email
            credentials = await get_user_credentials(request, email_account, db)
            service = build('gmail', 'v1', credentials=credentials)
            
            # Try to get thread
            thread = service.users().threads().get(
                userId='me',
                id=thread_id,
                format='full'
            ).execute()
            
            # Success! Process and return
            messages = thread.get('messages', [])
            message_list = []
            
            for msg in messages:
                headers = msg.get('payload', {}).get('headers', [])
                from_header = next((h['value'] for h in headers if h['name'] == 'From'), 'Unknown')
                to_header = next((h['value'] for h in headers if h['name'] == 'To'), 'Unknown')
                subject_header = next((h['value'] for h in headers if h['name'] == 'Subject'), '(No Subject)')
                date_header = next((h['value'] for h in headers if h['name'] == 'Date'), 'Unknown')
                
                # Get message body
                body = ""
                payload = msg.get('payload', {})
                if 'parts' in payload:
                    for part in payload['parts']:
                        if part.get('mimeType') == 'text/plain':
                            body_data = part.get('body', {}).get('data', '')
                            if body_data:
                                import base64
                                body = base64.urlsafe_b64decode(body_data).decode('utf-8', errors='ignore')
                                break
                elif payload.get('mimeType') == 'text/plain':
                    body_data = payload.get('body', {}).get('data', '')
                    if body_data:
                        import base64
                        body = base64.urlsafe_b64decode(body_data).decode('utf-8', errors='ignore')
                
                message_list.append({
                    "message_id": msg['id'],
                    "from": from_header,
                    "to": to_header,
                    "subject": subject_header,
                    "date": date_header,
                    "snippet": msg.get('snippet', ''),
                    "body": body,
                    "label_ids": msg.get('labelIds', [])
                })
            
            return {
                "success": True,
                "thread_id": thread_id,
                "message_count": len(messages),
                "messages": message_list,
                "email_account": email_account  # Return which email account was used
            }
            
        except HttpError as e:
            # If 404, try next email account
            if e.resp.status == 404:
                last_error = e
                continue
            # For other HTTP errors, raise immediately
            raise HTTPException(
                status_code=e.resp.status,
                detail=f"Gmail API error: {str(e)}"
            )
        except Exception as e:
            # For non-HTTP errors, try next email account but remember the error
            last_error = e
            continue
    
    # If we get here, thread was not found in any email account
    if last_error:
        if isinstance(last_error, HttpError) and last_error.resp.status == 404:
            raise HTTPException(
                status_code=404,
                detail=f"Thread {thread_id} not found in any of your email accounts"
            )
        else:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to get thread detail: {str(last_error)}"
            )
    else:
        raise HTTPException(
            status_code=404,
            detail=f"Thread {thread_id} not found"
        )


@router.post("/gmail/sync")
async def sync_inbox(
    request: Request,
    sync_request: SyncRequest = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Sync inbox - fetch and normalize email threads (方案 A: 不存储)
    
    This endpoint:
    1. Fetches threads from Gmail API
    2. Normalizes data to internal Thread schema
    3. Returns normalized threads (not stored in database)
    
    Returns normalized threads ready for Triage Agent processing
    """
    try:
        # Get credentials
        credentials = await get_user_credentials(request, sync_request.email, db)
        gmail_service = GmailService(credentials)
        
        # Get raw threads from Gmail API
        max_results = sync_request.max_results or 100
        days = sync_request.days or 30
        
        raw_threads = gmail_service.get_threads(max_results=max_results, days=days)
        
        # Normalize threads
        normalized_threads = []
        for raw_thread in raw_threads:
            try:
                normalized = gmail_service.normalize_thread(raw_thread)
                if normalized:
                    normalized_threads.append(normalized)
            except Exception as e:
                print(f"Error normalizing thread {raw_thread.get('id')}: {e}")
                continue
        
        return {
            "success": True,
            "synced_at": datetime.utcnow().isoformat() + 'Z',
            "thread_count": len(normalized_threads),
            "max_results": max_results,
            "days": days,
            "threads": normalized_threads
        }
    except Exception as e:
        error_str = str(e)
        print(f"Error syncing inbox: {e}")
        
        if "has not been used" in error_str or "is disabled" in error_str:
            raise HTTPException(
                status_code=403,
                detail="Gmail API is not enabled. Please enable it in Google Cloud Console."
            )
        else:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to sync inbox: {error_str}"
            )
