"""
Assist Chat API routes - General-purpose email assistant
"""
from fastapi import APIRouter, HTTPException, Depends, Request, Body
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List, AsyncGenerator
from pydantic import BaseModel
import json
import uuid
import asyncio
import threading
from sqlalchemy import select
from app.database import get_db
from app.routes.auth import get_user_credentials, get_current_user_id
from app.services.gmail_service import GmailService
from app.agents.assist_chat_agent import AssistChatAgent
from app.models import UserEmail, AssistChatSession

router = APIRouter()


class ChatRequest(BaseModel):
    """Request model for assist chat"""
    question: str
    session_id: Optional[str] = None  # If provided, continue existing session
    conversation_history: Optional[List[dict]] = None
    email: Optional[str] = None  # Optional email account to use for Gmail tools


class ChatResponse(BaseModel):
    """Response model for assist chat"""
    success: bool
    answer: Optional[str] = None
    session_id: Optional[str] = None
    citations: Optional[List[str]] = None
    tool_calls: Optional[List[dict]] = None
    thinking_steps: Optional[List[dict]] = None
    error: Optional[str] = None


class SessionListResponse(BaseModel):
    """Response model for listing sessions"""
    success: bool
    sessions: List[dict]
    error: Optional[str] = None


async def stream_chat_response(
    chat_request: ChatRequest,
    request: Request,
    db: AsyncSession
) -> AsyncGenerator[str, None]:
    """Stream chat response with thinking steps"""
    try:
        # Get user ID
        user_id = await get_current_user_id(request, db)
        
        # Get or create session
        session_id = chat_request.session_id
        if not session_id:
            session_id = str(uuid.uuid4())
        
        # Load existing session if continuing
        session = None
        conversation_history = chat_request.conversation_history or []
        
        if session_id:
            result = await db.execute(
                select(AssistChatSession).where(
                    AssistChatSession.session_id == session_id,
                    AssistChatSession.user_id == user_id
                )
            )
            session = result.scalar_one_or_none()
            if session and session.conversation_history:
                # Merge with provided history (provided history takes precedence)
                conversation_history = session.conversation_history
        
        # Get all user's email accounts for multi-email support
        from app.models import UserEmail
        result = await db.execute(
            select(UserEmail).where(UserEmail.user_id == user_id)
        )
        user_emails = result.scalars().all()
        
        # Get Gmail services for all email accounts
        gmail_services = {}  # Map email -> GmailService
        email_to_use = chat_request.email
        
        for user_email in user_emails:
            try:
                credentials = await get_user_credentials(request, user_email.email, db)
                gmail_services[user_email.email] = GmailService(credentials)
            except Exception as e:
                print(f"Warning: Could not initialize Gmail service for {user_email.email}: {e}")
        
        # Get primary Gmail service (for backward compatibility)
        primary_gmail_service = None
        if email_to_use and email_to_use in gmail_services:
            primary_gmail_service = gmail_services[email_to_use]
        elif user_emails:
            # Use primary email or first available
            primary_email = next((ue.email for ue in user_emails if ue.is_primary), user_emails[0].email)
            primary_gmail_service = gmail_services.get(primary_email)
        
        # Initialize agent with all Gmail services
        agent = AssistChatAgent(
            db=db,
            user_id=user_id,
            gmail_services=gmail_services,
            primary_gmail_service=primary_gmail_service,
            email=email_to_use
        )
        
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
                # Create a new event loop for this thread
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    result = loop.run_until_complete(
                        agent.chat(
                            question=chat_request.question,
                            conversation_history=conversation_history,
                            step_callback=step_callback
                        )
                    )
                    agent_result['result'] = result
                finally:
                    loop.close()
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
            
            # Stream new steps with delay for natural transition
            for step in new_steps:
                yield f"data: {json.dumps({'type': 'step', 'step': step})}\n\n"
                await asyncio.sleep(0.3)  # 300ms delay between steps
        
        # Wait for thread to finish
        agent_thread.join(timeout=60)
        
        # Check for errors
        if agent_result['error']:
            yield f"data: {json.dumps({'type': 'error', 'error': agent_result['error']})}\n\n"
            return
        
        # Stream final result
        result = agent_result['result']
        if result:
            tool_calls = result.get('tool_calls', [])
            used_web_search = any(
                tc.get('tool') == 'web_search' for tc in tool_calls if isinstance(tc, dict)
            )
            # Save session to database
            try:
                # Add user message and assistant response to history (include used_web_search for badge on reload)
                assistant_entry = {"role": "assistant", "content": result.get("answer", "")}
                if used_web_search:
                    assistant_entry["used_web_search"] = True
                new_history = conversation_history + [
                    {"role": "user", "content": chat_request.question},
                    assistant_entry
                ]
                
                if session:
                    # Update existing session
                    session.conversation_history = new_history
                    from sqlalchemy import func
                    session.updated_at = func.now()
                else:
                    # Create new session
                    session = AssistChatSession(
                        user_id=user_id,
                        session_id=session_id,
                        conversation_history=new_history
                    )
                    db.add(session)
                
                await db.commit()
            except Exception as e:
                print(f"Warning: Failed to save session: {e}")
                # Continue even if session save fails
            
            yield f"data: {json.dumps({
                'type': 'result',
                'success': result.get('success', False),
                'answer': result.get('answer'),
                'session_id': session_id,
                'citations': result.get('citations', []),
                'tool_calls': tool_calls,
                'thinking_steps': result.get('thinking_steps', []),
                'used_web_search': used_web_search,
                'error': result.get('error')
            })}\n\n"
        
    except Exception as e:
        error_str = str(e)
        print(f"Error in assist chat ask: {e}")
        import traceback
        print(traceback.format_exc())
        yield f"data: {json.dumps({'type': 'error', 'error': error_str})}\n\n"


@router.post("/assist-chat/ask")
async def ask_assist_chat(
    request: Request,
    chat_request: ChatRequest = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Ask a question to the Assist Chat Agent with streaming thinking steps.
    Returns Server-Sent Events (SSE) stream.
    
    Example questions:
    - "What important emails do I need to reply to?"
    - "Find emails about project deadlines"
    - "Show me high-priority emails from the last week"
    - "What emails need my attention?"
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


@router.get("/assist-chat/sessions")
async def list_sessions(
    request: Request,
    limit: int = 20,
    db: AsyncSession = Depends(get_db)
):
    """
    List recent chat sessions for the current user
    """
    try:
        user_id = await get_current_user_id(request, db)
        
        result = await db.execute(
            select(AssistChatSession)
            .where(AssistChatSession.user_id == user_id)
            .order_by(AssistChatSession.updated_at.desc())
            .limit(limit)
        )
        sessions = result.scalars().all()
        
        session_list = []
        for session in sessions:
            # Get first user message as preview
            preview = "New conversation"
            if session.conversation_history:
                for msg in session.conversation_history:
                    if msg.get("role") == "user":
                        preview = msg.get("content", "")[:100]
                        break
            
            session_list.append({
                "session_id": session.session_id,
                "preview": preview,
                "created_at": session.created_at.isoformat() if session.created_at else None,
                "updated_at": session.updated_at.isoformat() if session.updated_at else None,
                "message_count": len(session.conversation_history) if session.conversation_history else 0
            })
        
        return {
            "success": True,
            "sessions": session_list
        }
    except Exception as e:
        error_str = str(e)
        print(f"Error listing sessions: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list sessions: {error_str}"
        )


@router.get("/assist-chat/sessions/{session_id}")
async def get_session(
    session_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Get a specific chat session with full conversation history
    """
    try:
        user_id = await get_current_user_id(request, db)
        
        result = await db.execute(
            select(AssistChatSession).where(
                AssistChatSession.session_id == session_id,
                AssistChatSession.user_id == user_id
            )
        )
        session = result.scalar_one_or_none()
        
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        return {
            "success": True,
            "session_id": session.session_id,
            "conversation_history": session.conversation_history or [],
            "created_at": session.created_at.isoformat() if session.created_at else None,
            "updated_at": session.updated_at.isoformat() if session.updated_at else None
        }
    except HTTPException:
        raise
    except Exception as e:
        error_str = str(e)
        print(f"Error getting session: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get session: {error_str}"
        )


@router.delete("/assist-chat/sessions/{session_id}")
async def delete_session(
    session_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Delete a chat session
    """
    try:
        user_id = await get_current_user_id(request, db)
        
        result = await db.execute(
            select(AssistChatSession).where(
                AssistChatSession.session_id == session_id,
                AssistChatSession.user_id == user_id
            )
        )
        session = result.scalar_one_or_none()
        
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        await db.delete(session)
        await db.commit()
        
        return {
            "success": True,
            "message": "Session deleted"
        }
    except HTTPException:
        raise
    except Exception as e:
        error_str = str(e)
        print(f"Error deleting session: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete session: {error_str}"
        )
