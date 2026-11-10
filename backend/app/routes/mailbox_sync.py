"""Mailbox revisions used by the workspace without checking Gmail from the browser."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import MailboxSyncState, UserEmail
from app.routes.auth import get_current_user_id

router = APIRouter()


@router.get("/mailbox-sync")
async def mailbox_sync_status(user_id: int = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(UserEmail.email, MailboxSyncState.changed_at).join(
        MailboxSyncState, MailboxSyncState.user_email_id == UserEmail.id
    ).where(UserEmail.user_id == user_id, MailboxSyncState.changed_at.is_not(None)))).all()
    return {"revisions": {row.email: row.changed_at for row in rows}}
