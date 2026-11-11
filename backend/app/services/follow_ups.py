"""Follow-up records and inbound replies from Gmail metadata."""
from datetime import timezone
from email.utils import parseaddr
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import BigInteger, String, case, column, func, select, update, values

from app.models import FollowUp, UserEmail


FollowUpStatus = Literal["reply", "waiting", "later", "done"]


def follow_up_timezone(name):
    try:
        return ZoneInfo(name) if name else timezone.utc
    except (ZoneInfoNotFoundError, ValueError):
        return timezone.utc


def follow_up_record(item):
    return {name: getattr(item, name) for name in (
        "thread_id", "subject", "status", "due_at", "reopened_at", "updated_at",
    )}


async def list_follow_up_records(db, user_id, *, email=None, status=None, overdue=False, limit=40, offset=0):
    query = select(FollowUp, UserEmail.email).join(UserEmail, UserEmail.id == FollowUp.user_email_id).where(
        UserEmail.user_id == user_id
    )
    if email is not None:
        query = query.where(UserEmail.email == email)
    query = query.where(FollowUp.status == status) if status else query.where(FollowUp.status != "done")
    if overdue:
        query = query.where(FollowUp.status != "done", FollowUp.due_at < func.now())
    rows = (await db.execute(query.order_by(
        case((FollowUp.status == "done", None), else_=FollowUp.due_at).asc().nulls_last(),
        FollowUp.updated_at.desc(), FollowUp.thread_id, UserEmail.id,
    ).offset(offset).limit(limit + 1))).all()
    return {
        "items": [{**follow_up_record(item), "email": mailbox} for item, mailbox in rows[:limit]],
        "has_more": len(rows) > limit,
    }


def latest_inbound_at(thread, mailbox):
    latest = 0
    for message in thread.get("messages", []):
        if {"SENT", "DRAFT", "TRASH", "SPAM"}.intersection(message.get("labelIds", [])):
            continue
        headers = message.get("payload", {}).get("headers", [])
        sender = next((header["value"] for header in headers if header["name"].lower() == "from"), "")
        address = parseaddr(sender)[1].casefold()
        if not address or address == mailbox.casefold():
            continue
        try:
            latest = max(latest, int(message.get("internalDate", 0)))
        except (ValueError, TypeError):
            continue
    return latest


async def reopen_follow_ups(db, user_id, mailbox, threads):
    if not mailbox:
        return 0
    incoming = [
        (thread["id"], timestamp) for thread in threads
        if thread.get("id") and (timestamp := latest_inbound_at(thread, mailbox))
    ]
    if not incoming:
        return 0

    candidates = values(
        column("thread_id", String), column("received_at_ms", BigInteger), name="incoming"
    ).data(incoming)
    mailbox_id = select(UserEmail.id).where(
        UserEmail.user_id == user_id, UserEmail.email == mailbox
    ).scalar_subquery()
    result = await db.execute(
        update(FollowUp).where(
            FollowUp.user_email_id == mailbox_id,
            FollowUp.status == "waiting",
            FollowUp.thread_id == candidates.c.thread_id,
            FollowUp.last_inbound_at_ms < candidates.c.received_at_ms,
        ).values(
            status="reply", last_inbound_at_ms=candidates.c.received_at_ms,
            reopened_at=func.now(), updated_at=func.now(),
        )
    )
    return result.rowcount
