"""
Assist Chat API routes - General-purpose email assistant
"""
from fastapi import APIRouter, HTTPException, Depends, Request, Body, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Literal, Optional, List, AsyncGenerator
from pydantic import BaseModel, Field
import json
import uuid
import asyncio
from urllib.parse import urlparse

from app.config import settings
from sqlalchemy import func, select
from sqlalchemy.orm import defer
from app.database import get_db
from app.routes.auth import get_user_credentials, get_current_user_id
from app.services.gmail_service import GmailService
from app.models import UserEmail, AssistChatSession, AssistChatMessage
from app.services.chat_history import list_history_statement, load_history

router = APIRouter()


class ChatRequest(BaseModel):
    """Request model for assist chat"""
    question: str = Field(min_length=1, max_length=8000)
    action: Literal["unread", "attachments", "agenda", "reply_queue", "follow_ups"] | None = None
    session_id: Optional[str] = None  # If provided, continue existing session
    conversation_history: Optional[List[dict]] = Field(default=None, max_length=60)
    email: Optional[str] = None  # Optional email account to use for Gmail tools
    semantic_scope: Literal["selected", "all"] = "selected"
    local_timezone: str | None = Field(default=None, max_length=80)


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


async def public_web_result(query):
    from app.agents.tools.assist_chat_tools import execute_web_search
    from app.services.telemetry import timed_operation

    if not settings.ENABLE_WEB_SEARCH or not query or len(query) > 500:
        return {"success": False, "error": "Use /web followed by a public search query of up to 500 characters."}
    with timed_operation("tool", "public_web_search"):
        result = await execute_web_search(query)
    if not result.get("success"):
        return {"success": False, "error": "Public search is temporarily unavailable."}
    lines = []
    for row in result["results"]:
        url = row["link"]
        if urlparse(url).scheme not in ("http", "https") or any(c.isspace() for c in url):
            continue
        title = row["title"].replace("[", "").replace("]", "")[:200]
        snippet = " ".join(row["snippet"].split())[:320]
        lines.append(f"- [{title or 'Result'}](<{url}>) — {snippet}")
    return {"success": True, "answer": "\n".join(lines) or "No public results found.", "sources": [],
            "citations": [], "thinking_steps": [], "tool_calls": [{"tool": "web_search", "result": {"success": True}}]}


async def stream_chat_response(
    chat_request: ChatRequest, request: Request, db: AsyncSession, user_id: int
) -> AsyncGenerator[str, None]:
    """Stream progress as it is ready and keep database work on the server event loop."""
    try:
        session = None
        session_id = chat_request.session_id
        history = chat_request.conversation_history or []
        if session_id:
            session = await db.scalar(select(AssistChatSession).options(defer(AssistChatSession.conversation_history)).where(
                AssistChatSession.session_id == session_id, AssistChatSession.user_id == user_id,
            ))
            if session is None:
                yield _event({"type": "error", "error": "This conversation is unavailable. Start a new chat."})
                return
            history, _ = await load_history(db, session.id, 12)
        else:
            session_id = str(uuid.uuid4())

        question_parts = chat_request.question.strip().split(maxsplit=1)
        web_requested = not chat_request.action and question_parts and question_parts[0].lower() == "/web"
        public_query = question_parts[1] if web_requested and len(question_parts) == 2 else ""
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
            if web_requested or chat_request.action in ("reply_queue", "follow_ups") or (chat_request.action and account.email != selected):
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
                if web_requested:
                    work = public_web_result(public_query)
                elif chat_request.action:
                    from app.services.copilot_shortcuts import run_quick_action

                    work = run_quick_action(chat_request.action, db, user_id, gmail_services, selected,
                                            credentials_by_account.get(selected), steps.put_nowait,
                                            local_timezone=chat_request.local_timezone)
                else:
                    from app.agents.assist_chat_agent import AssistChatAgent

                    agent = AssistChatAgent(
                        db=db, user_id=user_id, gmail_services=gmail_services,
                        primary_gmail_service=gmail_services.get(selected), email=selected,
                        calendar_credentials=credentials_by_account.get(selected),
                        semantic_email=None if chat_request.semantic_scope == "all" else selected,
                        connected_mailboxes=[account.email for account in accounts],
                        local_timezone=chat_request.local_timezone,
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
        history_saved = False
        try:
            if session is None:
                session = AssistChatSession(user_id=user_id, session_id=session_id)
                db.add(session)
                await db.flush()
                # Keep recovery history sent by a client whose earlier turn could not be saved.
                db.add_all([
                    AssistChatMessage(session_id=session.id, role=entry["role"], content=entry["content"][:8000])
                    for entry in history if entry.get("role") in ("user", "assistant")
                    and isinstance(entry.get("content"), str)
                ])
            db.add_all([
                AssistChatMessage(session_id=session.id, role="user", content=chat_request.question),
                AssistChatMessage(session_id=session.id, role="assistant", content=result["answer"],
                                  sources=result["sources"], used_web_search=used_web_search),
            ])
            session.updated_at = func.now()
            await db.commit()
            history_saved = True
        except Exception as exc:
            print(f"Failed to save Copilot chat: {type(exc).__name__}")
            await db.rollback()
            session_id = None

        yield _event({"type": "result", **result, "session_id": session_id, "used_web_search": used_web_search,
                      "history_saved": history_saved})
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
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=10000),
    db: AsyncSession = Depends(get_db),
):
    user_id = await get_current_user_id(request, db)
    rows = (await db.execute(list_history_statement(user_id, limit, offset))).all()
    return {
        "success": True,
        "sessions": [{
            "session_id": row.session_id, "preview": row.preview,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        } for row in rows[:limit]],
        "next_offset": offset + limit if len(rows) > limit else None,
    }


@router.get("/assist-chat/sessions/{session_id}")
async def get_session(
    session_id: str,
    request: Request,
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0, le=100000),
    db: AsyncSession = Depends(get_db),
):
    user_id = await get_current_user_id(request, db)
    session = (await db.execute(select(
        AssistChatSession.id, AssistChatSession.created_at, AssistChatSession.updated_at,
    ).where(AssistChatSession.session_id == session_id, AssistChatSession.user_id == user_id))).one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    messages, next_offset = await load_history(db, session.id, limit, offset)
    return {
        "success": True, "session_id": session_id, "conversation_history": messages,
        "next_offset": next_offset,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
    }


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
