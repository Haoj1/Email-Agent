"""Search only the authenticated user's selected, indexed mailbox."""
import asyncio

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import EmailEmbedding, MailboxThreadIndex, UserEmail
from app.services.embedding_service import EmbeddingService


class RAGSearchService:
    def __init__(self):
        self.embedding_service = EmbeddingService()

    async def search_emails(
        self, user_id: int, query: str, limit: int = 5,
        db: AsyncSession | None = None, email: str | None = None,
    ) -> list[dict]:
        if not query or db is None or not settings.MAILBOX_EMBEDDINGS_ENABLED:
            return []

        scope = select(UserEmail.id).where(UserEmail.user_id == user_id)
        if email:
            scope = scope.where(UserEmail.email == email)
        current = select(EmailEmbedding.thread_id, EmailEmbedding.content, UserEmail.email).select_from(EmailEmbedding).join(
            UserEmail, UserEmail.id == EmailEmbedding.user_email_id
        ).join(MailboxThreadIndex, and_(
            MailboxThreadIndex.user_email_id == EmailEmbedding.user_email_id,
            MailboxThreadIndex.thread_id == EmailEmbedding.thread_id,
        )).where(
            EmailEmbedding.user_email_id.in_(scope),
            MailboxThreadIndex.indexed_version == MailboxThreadIndex.desired_version,
        )
        if not await db.scalar(select(current.exists())):
            return []

        vector = await asyncio.to_thread(self.embedding_service.get_embedding, query)
        distance = EmailEmbedding.embedding.cosine_distance(vector)
        result = await db.execute(current.add_columns((1 - distance).label("similarity")).order_by(distance).limit(limit))
        return [
            {"thread_id": row.thread_id, "email": row.email, "content": row.content, "similarity": float(row.similarity)}
            for row in result
        ]
