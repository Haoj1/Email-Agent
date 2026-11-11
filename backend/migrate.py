"""Bootstrap an empty PostgreSQL database or apply additive changes before release."""
import asyncio

from sqlalchemy import inspect, text

from app.database import Base, engine
from app.models import AssistChatMessage, FollowUp, LoginSession, MailboxSyncState, MailboxThreadIndex


async def migrate():
    try:
        async with engine.begin() as connection:
            await connection.execute(text("SELECT pg_advisory_xact_lock(415017, 1)"))
            existing = await connection.run_sync(lambda sync: inspect(sync).has_table("assist_chat_sessions"))
            if existing:
                for model in (AssistChatMessage, FollowUp, LoginSession, MailboxSyncState, MailboxThreadIndex):
                    await connection.run_sync(lambda sync: model.__table__.create(sync, checkfirst=True))
                await connection.execute(text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_review_since timestamptz, "
                    "ADD COLUMN IF NOT EXISTS ai_review_mode varchar(24) NOT NULL DEFAULT 'off'"
                ))
                await connection.execute(text(
                    "ALTER TABLE triage_results ADD COLUMN IF NOT EXISTS ai_reviewed boolean NOT NULL DEFAULT false, "
                    "ADD COLUMN IF NOT EXISTS ai_reviewed_through_ms bigint NOT NULL DEFAULT 0"
                ))
                await connection.execute(text(
                    "ALTER TABLE email_embeddings ADD COLUMN IF NOT EXISTS user_email_id integer "
                    "REFERENCES user_emails(id) ON DELETE CASCADE"
                ))
                await connection.execute(text(
                    "CREATE INDEX IF NOT EXISTS idx_email_embedding_mailbox_thread "
                    "ON email_embeddings(user_email_id, thread_id)"
                ))
            else:
                await connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
                await connection.run_sync(Base.metadata.create_all)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(migrate())
