"""
RAG Search Service
Handles semantic search over email embeddings
"""
from typing import List, Dict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from app.models import EmailEmbedding
from app.services.embedding_service import EmbeddingService

class RAGSearchService:
    """Service for semantic search using pgvector"""
    
    def __init__(self):
        self.embedding_service = EmbeddingService()

    async def search_emails(
        self, 
        user_id: int, 
        query: str, 
        limit: int = 5,
        db: AsyncSession = None
    ) -> List[Dict]:
        """
        Search for emails similar to the query string
        """
        if not query or not db:
            return []
            
        # 1. Generate embedding for the query
        query_vector = self.embedding_service.get_embedding(query)
        
        # 2. Perform vector similarity search using pgvector
        # <-> is the operator for Euclidean distance
        # <=> is the operator for cosine distance (recommended for embeddings)
        
        # We use a raw SQL fragment for the vector similarity because 
        # sqlalchemy-pgvector integration can be tricky with AsyncSession
        vector_str = "[" + ",".join(map(str, query_vector)) + "]"
        
        stmt = text(f"""
            SELECT thread_id, content, 1 - (embedding <=> '{vector_str}') as similarity
            FROM email_embeddings
            WHERE user_id = :user_id
            ORDER BY embedding <=> '{vector_str}'
            LIMIT :limit
        """)
        
        result = await db.execute(stmt, {"user_id": user_id, "limit": limit})
        rows = result.fetchall()
        
        search_results = []
        for row in rows:
            search_results.append({
                "thread_id": row[0],
                "content": row[1],
                "similarity": float(row[2])
            })
            
        return search_results
