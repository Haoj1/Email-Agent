"""
Thread Chat API routes - Interactive chat with email threads
"""
from fastapi import APIRouter, HTTPException, Depends, Request, Body
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List, AsyncGenerator
from pydantic import BaseModel
import json
from sqlalchemy import select
from app.database import get_db
from app.routes.auth import get_user_credentials, get_current_user_id
from app.services.gmail_service import GmailService
from app.agents.thread_chat_agent import ThreadChatAgent
from app.models import UserEmail

router = APIRouter()


class ChatRequest(BaseModel):
    """Request model for thread chat"""
    thread_id: str
    question: str
    conversation_history: Optional[List[dict]] = None
    email: Optional[str] = None


class ChatResponse(BaseModel):
    """Response model for thread chat"""
    success: bool
    answer: Optional[str] = None
    citations: Optional[List[str]] = None
    tool_calls: Optional[List[dict]] = None
    thinking_steps: Optional[List[dict]] = None
    error: Optional[str] = None


class DraftRequest(BaseModel):
    """Request model for draft generation"""
    thread_id: str
    instruction: Optional[str] = None
    tone: Optional[str] = "professional"
    email: Optional[str] = None
    save_to_gmail: Optional[bool] = False  # Whether to save to Gmail Draft


class DraftResponse(BaseModel):
    """Response model for draft generation"""
    success: bool
    subject: Optional[str] = None
    body: Optional[str] = None
    full_draft: Optional[str] = None
    gmail_draft_id: Optional[str] = None  # Gmail draft ID if saved
    error: Optional[str] = None


async def stream_chat_response(
    chat_request: ChatRequest,
    request: Request,
    db: AsyncSession
) -> AsyncGenerator[str, None]:
    """Stream chat response with thinking steps"""
    import asyncio
    import threading
    from concurrent.futures import ThreadPoolExecutor
    
    try:
        # Get user ID
        user_id = await get_current_user_id(request, db)
        
        # Determine which email account to use
        # First, try to find the thread in the specified email (or primary)
        # If not found, try all user's email accounts
        email_to_use = chat_request.email
        
        # Get all user's email accounts
        result = await db.execute(
            select(UserEmail).where(UserEmail.user_id == user_id)
        )
        user_emails = result.scalars().all()
        
        if not user_emails:
            yield f"data: {json.dumps({'type': 'error', 'error': 'No email accounts found'})}\n\n"
            return
        
        # Sort emails: specified email first, then primary, then others
        email_list = []
        if email_to_use:
            for ue in user_emails:
                if ue.email == email_to_use:
                    email_list.insert(0, ue.email)
                elif ue.is_primary and email_to_use not in email_list:
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
        
        # Try to find the thread in one of the email accounts
        gmail_service = None
        final_email = None
        
        for email_account in email_list:
            try:
                credentials = await get_user_credentials(request, email_account, db)
                test_service = GmailService(credentials)
                # Try to get the thread to verify it exists in this account
                test_service.get_thread_full(chat_request.thread_id)
                # Success! Use this email account
                gmail_service = test_service
                final_email = email_account
                break
            except Exception as e:
                # Thread not found in this account, try next
                continue
        
        if not gmail_service:
            yield f"data: {json.dumps({'type': 'error', 'error': f'Thread {chat_request.thread_id} not found in any of your email accounts'})}\n\n"
            return
        
        # Initialize agent with the correct email account
        agent = ThreadChatAgent(gmail_service, final_email)
        
        # Shared list to collect steps (thread-safe with lock)
        steps_list = []
        steps_lock = threading.Lock()
        agent_done = threading.Event()
        agent_result = {'result': None, 'error': None}
        
        def step_callback(step: dict):
            """Callback to collect thinking steps"""
            with steps_lock:
                steps_list.append(step)
        
        def run_agent():
            """Run agent in thread"""
            try:
                result = agent.chat(
                    thread_id=chat_request.thread_id,
                    question=chat_request.question,
                    conversation_history=chat_request.conversation_history,
                    step_callback=step_callback
                )
                agent_result['result'] = result
            except Exception as e:
                agent_result['error'] = str(e)
            finally:
                agent_done.set()
        
        # Start agent in thread
        agent_thread = threading.Thread(target=run_agent, daemon=True)
        agent_thread.start()
        
        # Stream steps as they're generated
        last_step_count = 0
        while not agent_done.is_set() or last_step_count < len(steps_list):
            await asyncio.sleep(0.1)  # Check every 100ms
            
            # Get new steps
            with steps_lock:
                new_steps = steps_list[last_step_count:]
                last_step_count = len(steps_list)
            
            # Stream new steps
            for step in new_steps:
                yield f"data: {json.dumps({'type': 'step', 'step': step})}\n\n"
        
        # Wait for thread to finish
        agent_thread.join(timeout=30)
        
        # Check for errors
        if agent_result['error']:
            yield f"data: {json.dumps({'type': 'error', 'error': agent_result['error']})}\n\n"
            return
        
        # Stream final result
        result = agent_result['result']
        if result:
            yield f"data: {json.dumps({
                'type': 'result',
                'success': result.get('success', False),
                'answer': result.get('answer'),
                'citations': result.get('citations', []),
                'tool_calls': result.get('tool_calls', []),
                'thinking_steps': result.get('thinking_steps', []),
                'error': result.get('error')
            })}\n\n"
        
    except Exception as e:
        error_str = str(e)
        print(f"Error in thread chat ask: {e}")
        import traceback
        print(traceback.format_exc())
        yield f"data: {json.dumps({'type': 'error', 'error': error_str})}\n\n"


@router.post("/thread-chat/ask")
async def ask_thread_question(
    request: Request,
    chat_request: ChatRequest = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Ask a question about a specific email thread with streaming thinking steps.
    Returns Server-Sent Events (SSE) stream.
    
    Example questions:
    - "What does this email want me to do?"
    - "Summarize the key points"
    - "What are the deadlines mentioned?"
    - "Who are the main participants?"
    """
    return StreamingResponse(
        stream_chat_response(chat_request, request, db),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.post("/thread-chat/draft", response_model=DraftResponse)
async def generate_draft_reply(
    request: Request,
    draft_request: DraftRequest = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Generate a draft reply for an email thread.
    Returns draft text only - does not send the email.
    
    Args:
        thread_id: Gmail thread ID
        instruction: Optional instruction (e.g., "be concise", "ask for clarification")
        tone: Tone of reply (professional, friendly, formal, casual)
        email: Email account to use (optional)
    """
    try:
        # Get user ID
        user_id = await get_current_user_id(request, db)
        
        # Determine which email account to use (similar to ask_thread_question)
        email_to_use = draft_request.email
        
        # Get all user's email accounts
        result = await db.execute(
            select(UserEmail).where(UserEmail.user_id == user_id)
        )
        user_emails = result.scalars().all()
        
        if not user_emails:
            raise HTTPException(status_code=404, detail="No email accounts found")
        
        # Sort emails: specified email first, then primary, then others
        email_list = []
        if email_to_use:
            for ue in user_emails:
                if ue.email == email_to_use:
                    email_list.insert(0, ue.email)
                elif ue.is_primary and email_to_use not in email_list:
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
        
        # Try to find the thread in one of the email accounts
        gmail_service = None
        final_email = None
        
        for email_account in email_list:
            try:
                credentials = await get_user_credentials(request, email_account, db)
                test_service = GmailService(credentials)
                # Try to get the thread to verify it exists in this account
                test_service.get_thread_full(draft_request.thread_id)
                # Success! Use this email account
                gmail_service = test_service
                final_email = email_account
                break
            except Exception as e:
                # Thread not found in this account, try next
                continue
        
        if not gmail_service:
            raise HTTPException(
                status_code=404,
                detail=f"Thread {draft_request.thread_id} not found in any of your email accounts"
            )
        
        # Initialize agent
        agent = ThreadChatAgent(gmail_service, final_email)
        
        # Generate draft
        result = agent.draft_reply(
            thread_id=draft_request.thread_id,
            instruction=draft_request.instruction,
            tone=draft_request.tone or "professional"
        )
        
        if not result.get("success"):
            return DraftResponse(
                success=False,
                error=result.get("error", "Failed to generate draft")
            )
        
        # Save to Gmail if requested
        gmail_draft_id = None
        if draft_request.save_to_gmail:
            draft_result = gmail_service.create_draft(
                to=result.get("to", ""),
                subject=result.get("subject", ""),
                body=result.get("body", ""),
                thread_id=draft_request.thread_id
            )
            if draft_result.get("success"):
                gmail_draft_id = draft_result.get("draft_id")
            else:
                # Return error but still return the draft text
                return DraftResponse(
                    success=True,
                    subject=result.get("subject"),
                    body=result.get("body"),
                    full_draft=result.get("full_draft"),
                    gmail_draft_id=None,
                    error=f"Generated draft but failed to save to Gmail: {draft_result.get('error')}"
                )
        
        return DraftResponse(
            success=True,
            subject=result.get("subject"),
            body=result.get("body"),
            full_draft=result.get("full_draft"),
            gmail_draft_id=gmail_draft_id,
            error=None
        )
        
    except Exception as e:
        error_str = str(e)
        print(f"Error generating draft: {e}")
        import traceback
        print(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate draft: {error_str}"
        )
