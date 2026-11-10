"""Bootstrap an empty PostgreSQL database or apply additive changes before release."""
import asyncio

from sqlalchemy import inspect, text

from app.database import Base, engine
from app.models import AssistChatMessage


async def migrate():
    try:
        async with engine.begin() as connection:
            await connection.execute(text("SELECT pg_advisory_xact_lock(415017, 1)"))
            existing = await connection.run_sync(lambda sync: inspect(sync).has_table("assist_chat_sessions"))
            if existing:
                await connection.run_sync(lambda sync: AssistChatMessage.__table__.create(sync, checkfirst=True))
            else:
                await connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
                await connection.run_sync(Base.metadata.create_all)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(migrate())
