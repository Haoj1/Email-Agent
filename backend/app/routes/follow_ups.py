"""One follow-up record per Gmail conversation and connected mailbox."""
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from googleapiclient.errors import HttpError
from pydantic import AwareDatetime, BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import FollowUp, UserEmail
from app.routes.auth import get_current_user_id, get_user_credentials
from app.services.follow_ups import FollowUpStatus, follow_up_record, latest_inbound_at, list_follow_up_records
from app.services.gmail_service import GmailService

router = APIRouter(prefix="/follow-ups")


class FollowUpChange(BaseModel):
    status: FollowUpStatus
    due_at: AwareDatetime | None = None
    expected_updated_at: AwareDatetime | None = None


async def owned_mailbox(db, user_id, email):
    mailbox = await db.scalar(select(UserEmail.id).where(UserEmail.user_id == user_id, UserEmail.email == email))
    if mailbox is None:
        raise HTTPException(404, "Mailbox not found")
    return mailbox


@router.get("")
async def list_follow_ups(
    email: str = Query(..., min_length=1, max_length=320), status: FollowUpStatus | None = None,
    limit: int = Query(40, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user_id: int = Depends(get_current_user_id), db: AsyncSession = Depends(get_db),
):
    await owned_mailbox(db, user_id, email)
    return await list_follow_up_records(db, user_id, email=email, status=status, limit=limit, offset=offset)

@router.get("/{thread_id}")
async def get_follow_up(
    thread_id: str = Path(..., min_length=1, max_length=128), email: str = Query(..., min_length=1, max_length=320),
    user_id: int = Depends(get_current_user_id), db: AsyncSession = Depends(get_db),
):
    mailbox = await owned_mailbox(db, user_id, email)
    item = await db.get(FollowUp, (mailbox, thread_id))
    return {"item": follow_up_record(item) if item else None}


@router.put("/{thread_id}")
async def save_follow_up(
    change: FollowUpChange, request: Request,
    thread_id: str = Path(..., min_length=1, max_length=128), email: str = Query(..., min_length=1, max_length=320),
    user_id: int = Depends(get_current_user_id), db: AsyncSession = Depends(get_db),
):
    mailbox = await owned_mailbox(db, user_id, email)
    existing = await db.get(FollowUp, (mailbox, thread_id))
    conditional = "expected_updated_at" in change.model_fields_set
    if conditional and (existing.updated_at if existing else None) != change.expected_updated_at:
        raise HTTPException(409, "This follow-up changed. Ask Copilot for an updated action.")
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
    updates = {
        "status": change.status, "due_at": change.due_at,
        "last_inbound_at_ms": func.greatest(FollowUp.last_inbound_at_ms, inbound_at),
        "reopened_at": None, "updated_at": func.now(),
    }
    if not conditional:
        statement = statement.on_conflict_do_update(
            index_elements=[FollowUp.user_email_id, FollowUp.thread_id], set_=updates,
        )
    elif change.expected_updated_at is None:
        statement = statement.on_conflict_do_nothing(index_elements=[FollowUp.user_email_id, FollowUp.thread_id])
    else:
        statement = update(FollowUp).where(
            FollowUp.user_email_id == mailbox, FollowUp.thread_id == thread_id,
            FollowUp.updated_at == change.expected_updated_at,
        ).values(**updates)
    item = (await db.scalars(statement.returning(FollowUp)
                            .execution_options(populate_existing=True))).one_or_none()
    if item is None:
        raise HTTPException(409, "This follow-up changed. Ask Copilot for an updated action.")
    await db.commit()
    return {"item": follow_up_record(item)}
