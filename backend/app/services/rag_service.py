"""Search existing email vectors using pgvector cosine distance."""
import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import EmailEmbedding
from app.services.embedding_service import EmbeddingService


class RAGSearchService:
    def __init__(self):
        self.embedding_service = EmbeddingService()

    async def search_emails(
        self,
        user_id: int,
        query: str,
        limit: int = 5,
        db: AsyncSession = None,
    ) -> list[dict]:
        if not query or not db:
            return []

        vector = await asyncio.to_thread(self.embedding_service.get_embedding, query)
        distance = EmailEmbedding.embedding.cosine_distance(vector)
        statement = (
            select(EmailEmbedding.thread_id, EmailEmbedding.content, (1 - distance).label("similarity"))
            .where(EmailEmbedding.user_id == user_id)
            .order_by(distance)
            .limit(limit)
        )
        result = await db.execute(statement)
        return [
            {"thread_id": row.thread_id, "content": row.content, "similarity": float(row.similarity)}
            for row in result
        ]
