"""
Assist Chat API routes - General-purpose email assistant
"""
from fastapi import APIRouter, HTTPException, Depends, Request, Body
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Literal, Optional, List, AsyncGenerator
from pydantic import BaseModel, Field
import json
import uuid
import asyncio
from sqlalchemy import func, select
from app.database import get_db
from app.routes.auth import get_user_credentials, get_current_user_id
from app.services.gmail_service import GmailService
from app.models import UserEmail, AssistChatSession

router = APIRouter()


class ChatRequest(BaseModel):
    """Request model for assist chat"""
    question: str = Field(min_length=1, max_length=8000)
    action: Literal["unread", "attachments", "agenda", "reply_queue"] | None = None
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


def _event(payload):
    return f"data: {json.dumps(payload)}\n\n"


async def stream_chat_response(
    chat_request: ChatRequest, request: Request, db: AsyncSession, user_id: int
) -> AsyncGenerator[str, None]:
    """Stream progress as it is ready and keep database work on the server event loop."""
    try:
        session = None
        session_id = chat_request.session_id
        history = chat_request.conversation_history or []
        if session_id:
            session = await db.scalar(select(AssistChatSession).where(
                AssistChatSession.session_id == session_id, AssistChatSession.user_id == user_id,
            ))
            if session is None:
                yield _event({"type": "error", "error": "This conversation is unavailable. Start a new chat."})
                return
            history = session.conversation_history or []
        else:
            session_id = str(uuid.uuid4())

        yield _event({"type": "step", "step": {"type": "thinking", "content": "Preparing Copilot…"}})
        accounts = (await db.scalars(select(UserEmail).where(UserEmail.user_id == user_id))).all()
        if chat_request.email and all(account.email != chat_request.email for account in accounts):
            yield _event({"type": "error", "error": "The selected mailbox is unavailable."})
            return
        gmail_services = {}
        credentials_by_account = {}
        primary_email = next((account.email for account in accounts if account.is_primary), None)
        selected = chat_request.email or primary_email or (accounts[0].email if accounts else None)
        for account in accounts:
            if chat_request.action == "reply_queue" or (chat_request.action and account.email != selected):
                continue
            try:
                credentials = await get_user_credentials(request, account.email, db)
                gmail_services[account.email] = await asyncio.to_thread(GmailService, credentials)
                credentials_by_account[account.email] = credentials
            except Exception as exc:
                print(f"Copilot mailbox unavailable: {type(exc).__name__}")
        if not chat_request.email and not chat_request.action and selected not in gmail_services:
            selected = next(iter(gmail_services), None)

        steps = asyncio.Queue()

        async def run_agent():
            try:
                if chat_request.action:
                    from app.services.copilot_shortcuts import run_quick_action

                    work = run_quick_action(chat_request.action, db, user_id, gmail_services, selected,
                                            credentials_by_account.get(selected), steps.put_nowait)
                else:
                    from app.agents.assist_chat_agent import AssistChatAgent

                    agent = AssistChatAgent(
                        db=db, user_id=user_id, gmail_services=gmail_services,
                        primary_gmail_service=gmail_services.get(selected), email=selected,
                        calendar_credentials=credentials_by_account.get(selected),
                    )
                    work = agent.chat(chat_request.question, history, steps.put_nowait)
                return await asyncio.wait_for(work, timeout=75)
            finally:
                steps.put_nowait(None)

        task = asyncio.create_task(run_agent())
        try:
            while True:
                try:
                    step = await asyncio.wait_for(steps.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                if step is None:
                    break
                yield _event({"type": "step", "step": step})
            result = await task
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)

        if not result.get("success"):
            yield _event({"type": "error", "error": result.get("error") or "Copilot could not answer."})
            return
        used_web_search = any(
            call["tool"] == "web_search" and call["result"]["success"] for call in result["tool_calls"]
        )
        new_history = history + [
            {"role": "user", "content": chat_request.question},
            {"role": "assistant", "content": result["answer"], "sources": result["sources"],
             "used_web_search": used_web_search},
        ]
        try:
            if session is None:
                db.add(AssistChatSession(user_id=user_id, session_id=session_id, conversation_history=new_history))
            else:
                session.conversation_history = new_history
                session.updated_at = func.now()
            await db.commit()
        except Exception as exc:
            print(f"Failed to save Copilot chat: {type(exc).__name__}")
            session_id = None

        yield _event({"type": "result", **result, "session_id": session_id, "used_web_search": used_web_search})
    except asyncio.TimeoutError:
        yield _event({"type": "error", "error": "Copilot timed out. Try a narrower question."})
    except Exception as exc:
        print(f"Copilot stream failed: {type(exc).__name__}")
        yield _event({"type": "error", "error": "Copilot could not complete the request. Please try again."})


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
    user_id = await get_current_user_id(request, db)
    return StreamingResponse(
        stream_chat_response(chat_request, request, db, user_id),
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
    except HTTPException:
        raise
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
