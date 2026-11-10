"""Index a small, durable backlog of changed Gmail conversations per mailbox."""
import asyncio
import hashlib
import logging

from googleapiclient.errors import HttpError
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.dialects.postgresql import insert

from app.models import EmailEmbedding, MailboxThreadIndex
from app.services.embedding_service import EmbeddingService
from app.services.gmail_service import GmailService

logger = logging.getLogger("uvicorn.error")
EXCLUDED_LABELS = {"DRAFT", "TRASH", "SPAM"}


def _index_chunks(messages, service):
    """Return at most four distinct excerpts from the three newest messages."""
    seen = set()
    excerpts = []
    for message in reversed(messages[-3:]):
        body = "\n".join(line for line in (message.get("body_text") or "").splitlines()
                         if not line.lstrip().startswith(">"))
        if len(body.strip()) < 10:
            continue
        chunks = service.chunk_text(body, chunk_size=800, overlap=60, max_chunks=2)
        for chunk in chunks:
            key = " ".join(chunk.split()).casefold()
            if key and key not in seen:
                seen.add(key)
                excerpts.append((message["message_id"], chunk))
                if len(excerpts) == 4:
                    return excerpts
    return excerpts


def searchable_messages(thread):
    return [
        message for message in thread.get("messages", [])
        if message.get("id") and not EXCLUDED_LABELS.intersection(message.get("labelIds", []))
    ][-3:]


def message_version(messages):
    return hashlib.sha256("\0".join(message["id"] for message in messages).encode()).hexdigest()


async def drop_index(db, mailbox, thread_ids):
    if thread_ids:
        await db.execute(delete(MailboxThreadIndex).where(
            MailboxThreadIndex.user_email_id == mailbox, MailboxThreadIndex.thread_id.in_(thread_ids)
        ))
        await db.execute(delete(EmailEmbedding).where(
            EmailEmbedding.user_email_id == mailbox, EmailEmbedding.thread_id.in_(thread_ids)
        ))


async def record_index_changes(db, mailbox, threads, removed):
    rows = []
    removed = set(removed)
    for thread in threads:
        messages = searchable_messages(thread)
        if messages:
            rows.append({"user_email_id": mailbox, "thread_id": thread["id"],
                         "desired_version": message_version(messages)})
        else:
            removed.add(thread["id"])
    await drop_index(db, mailbox, removed)
    if rows:
        insert_rows = insert(MailboxThreadIndex).values(rows)
        await db.execute(insert_rows.on_conflict_do_update(
            index_elements=[MailboxThreadIndex.user_email_id, MailboxThreadIndex.thread_id],
            set_={"desired_version": insert_rows.excluded.desired_version, "updated_at": func.now()},
            where=MailboxThreadIndex.desired_version != insert_rows.excluded.desired_version,
        ))


async def index_pending(db, mailbox, user_id):
    from app.routes.auth import get_mailbox_credentials

    try:
        locked = await db.scalar(text("SELECT pg_try_advisory_xact_lock(415019, :mailbox)"), {"mailbox": mailbox})
        if not locked:
            await db.rollback()
            return
        pending = (await db.execute(select(MailboxThreadIndex.thread_id, MailboxThreadIndex.desired_version)
            .where(MailboxThreadIndex.user_email_id == mailbox,
                   MailboxThreadIndex.indexed_version.is_distinct_from(MailboxThreadIndex.desired_version))
            .order_by(MailboxThreadIndex.updated_at, MailboxThreadIndex.thread_id).limit(2))).all()
        if not pending:
            await db.rollback()
            return

        gmail = await asyncio.to_thread(GmailService, await get_mailbox_credentials(db, mailbox))
        embeddings = EmbeddingService()
        for thread_id, version in pending:
            candidate = update(MailboxThreadIndex).where(
                MailboxThreadIndex.user_email_id == mailbox, MailboxThreadIndex.thread_id == thread_id,
                MailboxThreadIndex.desired_version == version,
            )
            try:
                raw = await asyncio.to_thread(gmail.get_thread_full, thread_id)
            except HttpError as exc:
                if exc.resp.status == 404:
                    await db.execute(candidate.values(updated_at=func.now()))
                    continue
                raise

            messages = searchable_messages(raw)
            if message_version(messages) != version:
                # The next Gmail history page will publish this newer version.
                await db.execute(candidate.values(updated_at=func.now()))
                continue
            normalized = gmail.normalize_thread({**raw, "messages": messages}, message_limit=3)
            excerpts = _index_chunks(normalized["messages"], embeddings) if normalized else []
            vectors = await asyncio.to_thread(embeddings.get_embeddings, [chunk for _, chunk in excerpts])
            if len(vectors) != len(excerpts):
                raise ValueError("Embedding service returned an incomplete batch")

            updated = await db.execute(candidate.values(indexed_version=version, updated_at=func.now()))
            if not updated.rowcount:
                continue
            await db.execute(delete(EmailEmbedding).where(
                EmailEmbedding.user_email_id == mailbox, EmailEmbedding.thread_id == thread_id
            ))
            db.add_all([
                EmailEmbedding(user_id=user_id, user_email_id=mailbox, thread_id=thread_id,
                               message_id=message_id, content=chunk, embedding=vector)
                for (message_id, chunk), vector in zip(excerpts, vectors)
            ])
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.warning("mailbox_index failure=%s", type(exc).__name__)
