"""One follow-up record per Gmail conversation and connected mailbox."""
import asyncio
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from googleapiclient.errors import HttpError
from pydantic import AwareDatetime, BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import FollowUp, UserEmail
from app.routes.auth import get_current_user_id, get_user_credentials
from app.services.follow_ups import latest_inbound_at
from app.services.gmail_service import GmailService

router = APIRouter(prefix="/follow-ups")
Status = Literal["reply", "waiting", "later", "done"]


class FollowUpChange(BaseModel):
    status: Status
    due_at: AwareDatetime | None = None


def record(item):
    return {name: getattr(item, name) for name in (
        "thread_id", "subject", "status", "due_at", "reopened_at", "updated_at",
    )}


async def owned_mailbox(db, user_id, email):
    mailbox = await db.scalar(select(UserEmail.id).where(UserEmail.user_id == user_id, UserEmail.email == email))
    if mailbox is None:
        raise HTTPException(404, "Mailbox not found")
    return mailbox


@router.get("")
async def list_follow_ups(
    email: str = Query(..., min_length=1, max_length=320), status: Status | None = None,
    limit: int = Query(40, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user_id: int = Depends(get_current_user_id), db: AsyncSession = Depends(get_db),
):
    mailbox = await owned_mailbox(db, user_id, email)
    query = select(FollowUp).where(FollowUp.user_email_id == mailbox)
    query = query.where(FollowUp.status == status) if status else query.where(FollowUp.status != "done")
    rows = (await db.scalars(query.order_by(
        case((FollowUp.status == "done", None), else_=FollowUp.due_at).asc().nulls_last(),
        FollowUp.updated_at.desc(), FollowUp.thread_id,
    ).offset(offset).limit(limit + 1))).all()
    return {"items": [record(row) for row in rows[:limit]], "has_more": len(rows) > limit}


@router.get("/{thread_id}")
async def get_follow_up(
    thread_id: str = Path(..., min_length=1, max_length=128), email: str = Query(..., min_length=1, max_length=320),
    user_id: int = Depends(get_current_user_id), db: AsyncSession = Depends(get_db),
):
    mailbox = await owned_mailbox(db, user_id, email)
    item = await db.get(FollowUp, (mailbox, thread_id))
    return {"item": record(item) if item else None}


@router.put("/{thread_id}")
async def save_follow_up(
    change: FollowUpChange, request: Request,
    thread_id: str = Path(..., min_length=1, max_length=128), email: str = Query(..., min_length=1, max_length=320),
    user_id: int = Depends(get_current_user_id), db: AsyncSession = Depends(get_db),
):
    mailbox = await owned_mailbox(db, user_id, email)
    existing = await db.get(FollowUp, (mailbox, thread_id))
    subject = existing.subject if existing else ""
    inbound_at = existing.last_inbound_at_ms if existing else 0
    if existing is None or change.status == "waiting":
        credentials = await get_user_credentials(request, email, db)
        await db.commit()
        try:
            thread = await asyncio.to_thread(lambda: GmailService(credentials).get_thread_metadata(thread_id))
        except HttpError as exc:
            if exc.resp.status == 404:
                raise HTTPException(404, "Conversation not found in this mailbox") from exc
            raise HTTPException(502, "Could not read the conversation from Gmail") from exc
        if thread.get("id") != thread_id or not thread.get("messages"):
            raise HTTPException(404, "Conversation not found in this mailbox")
        headers = thread["messages"][0].get("payload", {}).get("headers", [])
        subject = next((h["value"] for h in headers if h["name"].lower() == "subject"), "")
        inbound_at = latest_inbound_at(thread, email)
    statement = insert(FollowUp).values(
        user_email_id=mailbox, thread_id=thread_id, subject=subject[:512],
        status=change.status, due_at=change.due_at, last_inbound_at_ms=inbound_at,
    )
    item = (await db.scalars(statement.on_conflict_do_update(
        index_elements=[FollowUp.user_email_id, FollowUp.thread_id],
        set_={
            "status": statement.excluded.status, "due_at": statement.excluded.due_at,
            "last_inbound_at_ms": func.greatest(FollowUp.last_inbound_at_ms, statement.excluded.last_inbound_at_ms),
            "reopened_at": None, "updated_at": func.now(),
        },
    ).returning(FollowUp).execution_options(populate_existing=True))).one()
    await db.commit()
    return {"item": record(item)}
