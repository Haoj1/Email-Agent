"""Generate compatible local embeddings with bounded inference memory."""
import os
from threading import Lock


class EmbeddingService:
    _model = None
    _inference_lock = Lock()
    _batch_size = 4

    @classmethod
    def _encode(cls, texts):
        # Initialization and inference share the lock so overlapping requests
        # cannot load two models or allocate inference buffers concurrently.
        with cls._inference_lock:
            if cls._model is None:
                from sentence_transformers import SentenceTransformer

                model_name = os.getenv("EMBEDDING_MODEL_NAME", "all-MiniLM-L6-v2")
                cls._model = SentenceTransformer(model_name)
            return cls._model.encode(texts, batch_size=cls._batch_size).tolist()

    def get_embedding(self, text: str) -> list[float]:
        if not text or not text.strip():
            return [0.0] * 384
        return self._encode(text)

    def get_embeddings(self, texts: list[str]) -> list[list[float]]:
        return self._encode(texts) if texts else []

    def chunk_text(
        self, text: str, chunk_size: int = 500, overlap: int = 50, *,
        max_chunks: int | None = None,
    ) -> list[str]:
        step = chunk_size - overlap
        if step <= 0:
            raise ValueError("chunk_size must exceed overlap")
        stop = len(text)
        if max_chunks is not None:
            stop = min(stop, max_chunks * step)
        return [text[start:start + chunk_size] for start in range(0, stop, step)]
