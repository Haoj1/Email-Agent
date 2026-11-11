import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.database import get_db

router = APIRouter()

@router.get("/health")
async def health_check():
    return {
        "status": "ok",
        "message": "Email Agent Backend is running"
    }


@router.get("/ready")
async def readiness(db=Depends(get_db)):
    async def check_schema():
        return await db.scalar(text(
            "SELECT to_regclass('login_sessions') IS NOT NULL "
            "AND to_regclass('follow_ups') IS NOT NULL "
            "AND to_regclass('assist_chat_messages') IS NOT NULL "
            "AND to_regclass('mailbox_sync_state') IS NOT NULL "
            "AND to_regclass('mailbox_thread_index') IS NOT NULL "
            "AND EXISTS (SELECT 1 FROM pg_attribute "
            "WHERE attrelid = to_regclass('email_embeddings') AND attname = 'user_email_id' AND NOT attisdropped) "
            "AND EXISTS (SELECT 1 FROM pg_attribute "
            "WHERE attrelid = to_regclass('triage_results') AND attname = 'ai_reviewed' AND NOT attisdropped) "
            "AND (SELECT count(*) FROM pg_attribute WHERE attrelid = to_regclass('users') "
            "AND attname IN ('ai_review_since', 'ai_review_mode') AND NOT attisdropped) = 2 "
            "AND (SELECT count(*) FROM pg_attribute WHERE attrelid = to_regclass('triage_results') "
            "AND attname IN ('ai_reviewed_through_ms', 'last_inbound_at_ms', 'reviewed_at') AND NOT attisdropped) = 3"
        ))
    try:
        if await asyncio.wait_for(check_schema(), timeout=3):
            return {"status": "ready"}
    except (TimeoutError, SQLAlchemyError):
        pass
    raise HTTPException(503, "Database is unavailable or migrations are pending")
