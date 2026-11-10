"""
Embedding Service
Handles local text embedding generation using sentence-transformers
"""
import os
from threading import Lock
from typing import List

class EmbeddingService:
    """Service for generating embeddings using local models"""
    
    _instance = None
    _model = None
    _model_lock = Lock()
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(EmbeddingService, cls).__new__(cls)
        return cls._instance
    
    def __init__(self):
        if EmbeddingService._model is None:
            with EmbeddingService._model_lock:
                if EmbeddingService._model is None:
                    from sentence_transformers import SentenceTransformer

                    model_name = os.getenv("EMBEDDING_MODEL_NAME", "all-MiniLM-L6-v2")
                    EmbeddingService._model = SentenceTransformer(model_name)

    def get_embedding(self, text: str) -> List[float]:
        """Generate embedding for a single string"""
        if not text or not text.strip():
            return [0.0] * 384
            
        embedding = EmbeddingService._model.encode(text)
        return embedding.tolist()

    def get_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for a list of strings"""
        if not texts:
            return []
            
        embeddings = EmbeddingService._model.encode(texts)
        return embeddings.tolist()

    def chunk_text(self, text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
        """Split text into smaller chunks for better RAG retrieval"""
        if not text:
            return []
            
        # Simple character-based chunking for MVP
        chunks = []
        start = 0
        while start < len(text):
            end = start + chunk_size
            chunks.append(text[start:end])
            start += chunk_size - overlap
            
        return chunks
