"""Bounded Gmail synchronization with durable, per-mailbox cursors."""
import asyncio
from datetime import datetime, timedelta, timezone
import logging

from googleapiclient.errors import HttpError
from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.dialects.postgresql import insert

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import MailboxSyncState, OAuthToken, TriageResult, UserEmail
from app.routes.auth import get_mailbox_credentials
from app.services.background_tasks import index_pending, record_index_changes
from app.services.follow_ups import reopen_follow_ups
from app.services.gmail_service import GmailService
from app.services.triage_rules import classify_metadata
from app.services.triage_store import write_triage_results

logger = logging.getLogger("uvicorn.error")
HISTORY_TYPES = ("messagesAdded", "messagesDeleted", "labelsAdded", "labelsRemoved")


def changed_thread_ids(page):
    return list(dict.fromkeys(
        item["message"]["threadId"]
        for event in page.get("history", [])
        for kind in HISTORY_TYPES
        for item in event.get(kind, [])
        if item.get("message", {}).get("threadId")
    ))


async def sync_mailbox(db, account):
    # The transaction-scoped mailbox lock prevents overlapping sync across workers.
    locked = await db.scalar(text("SELECT pg_try_advisory_xact_lock(415018, :mailbox)"),
                             {"mailbox": account.id})
    if not locked:
        await db.rollback()
        return False

    state = await db.get(MailboxSyncState, account.id)
    now = datetime.now(timezone.utc)
    if state is not None and state.next_check_at > now:
        await db.rollback()
        return False
    if state is None:
        state = MailboxSyncState(user_email_id=account.id, next_check_at=now)
        db.add(state)

    try:
        credentials = await get_mailbox_credentials(db, account.id)
        service = await asyncio.to_thread(GmailService, credentials)
        removed = set()
        if state.history_id:
            try:
                page = await asyncio.to_thread(service.get_history_page, state.history_id, state.page_token)
            except HttpError as exc:
                if exc.resp.status != 404 and not (state.page_token and exc.resp.status == 400):
                    raise
                # Gmail can expire the history cursor or a pagination token.
                # Replay from the stored high-water mark before rebuilding it.
                if exc.resp.status == 404:
                    state.history_id = None
                state.page_token = None
                state.next_check_at = now + timedelta(seconds=15)
                await db.commit()
                return True
            ids = changed_thread_ids(page)
            raw = await asyncio.to_thread(service.get_metadata_batch, ids)
            removed = set(ids) - {item["id"] for item in raw}
            state.page_token = page.get("nextPageToken")
            if not state.page_token:
                state.history_id = page["historyId"]
        else:
            if not state.bootstrap_history_id:
                state.bootstrap_history_id = await asyncio.to_thread(service.get_history_id)
            since = state.synced_at or (now - timedelta(days=7))
            after = int(since.timestamp()) - 600
            try:
                raw, state.page_token = await asyncio.to_thread(
                    service.get_thread_page, 25, 7, query=f"after:{after}",
                    page_token=state.page_token, strict=True,
                )
            except HttpError as exc:
                if not state.page_token or exc.resp.status not in (400, 404):
                    raise
                state.page_token = None
                state.next_check_at = now + timedelta(seconds=15)
                await db.commit()
                return True
            if not state.page_token:
                state.history_id = state.bootstrap_history_id
                state.bootstrap_history_id = None

        await reopen_follow_ups(db, account.user_id, account.email, raw)
        if removed:
            await db.execute(delete(TriageResult).where(
                TriageResult.user_id == account.user_id, TriageResult.email == account.email,
                TriageResult.thread_id.in_(removed),
            ))
        rows = [
            {**classify_metadata(thread), "user_id": account.user_id, "email": account.email,
             "message_count": thread["message_count"], "ai_reviewed": False}
            for item in raw if (thread := service.normalize_thread(item, message_limit=3))
        ]
        await write_triage_results(db, rows)
        if settings.MAILBOX_EMBEDDINGS_ENABLED:
            await record_index_changes(db, account.id, raw, removed)
        if not state.page_token:
            state.synced_at = now
        if raw or removed or state.changed_at is None:
            state.changed_at = now
        delay = 15 if state.page_token else max(30, settings.MAILBOX_SYNC_INTERVAL_SECONDS)
        state.next_check_at = now + timedelta(seconds=delay)
        await db.commit()
        return True
    except Exception as exc:
        await db.rollback()
        logger.warning("mailbox_sync failure=%s", type(exc).__name__)
        retry = insert(MailboxSyncState).values(
            user_email_id=account.id, next_check_at=now + timedelta(minutes=5)
        )
        await db.execute(retry.on_conflict_do_update(
            index_elements=[MailboxSyncState.user_email_id],
            set_={"next_check_at": retry.excluded.next_check_at},
            where=MailboxSyncState.next_check_at <= now,
        ))
        await db.commit()
        return False


async def run_mailbox_worker():
    while True:
        try:
            async with AsyncSessionLocal() as db:
                accounts = (await db.scalars(select(UserEmail).outerjoin(MailboxSyncState).where(
                    UserEmail.verified.is_(True),
                    select(OAuthToken.user_email_id).where(
                        OAuthToken.user_email_id == UserEmail.id, OAuthToken.provider == "google"
                    ).exists(),
                    or_(MailboxSyncState.user_email_id.is_(None), MailboxSyncState.next_check_at <= func.now()),
                ).order_by(MailboxSyncState.next_check_at.asc().nulls_first(), UserEmail.id).limit(8))).all()
                # Detached records remain available if a later mailbox transaction rolls back.
                db.expunge_all()
                await db.commit()
                for account in accounts:
                    synced = await sync_mailbox(db, account)
                    if synced and settings.MAILBOX_EMBEDDINGS_ENABLED:
                        await index_pending(db, account.id, account.user_id)
        except Exception as exc:
            logger.warning("mailbox_worker failure=%s", type(exc).__name__)
        await asyncio.sleep(15)
