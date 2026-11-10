"""Detect inbound replies from Gmail metadata already fetched by synchronization."""
from email.utils import parseaddr

from sqlalchemy import BigInteger, String, column, func, select, update, values

from app.models import FollowUp, UserEmail


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
