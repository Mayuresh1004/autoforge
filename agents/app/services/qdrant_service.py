from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams

from app.config.settings import get_settings
from app.config.logging import logger


class QdrantService:
    """
    Qdrant vector database service.

    Future embedding collections:
    - CVE descriptions and metadata
    - Security documentation and best practices
    - Fix history from past patches
    - Code snippets for RAG-based patch generation
    """

    def __init__(self) -> None:
        self._settings = get_settings()
        self._client: QdrantClient | None = None

    @property
    def client(self) -> QdrantClient:
        if self._client is None:
            self._client = QdrantClient(
                url=self._settings.qdrant_url,
                api_key=self._settings.qdrant_api_key or None,
            )
        return self._client

    def ensure_collection(self) -> None:
        collection_name = self._settings.qdrant_collection_name
        dimension = self._settings.embedding_dimension

        collections = self.client.get_collections().collections
        exists = any(c.name == collection_name for c in collections)

        if not exists:
            self.client.create_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(
                    size=dimension,
                    distance=Distance.COSINE,
                ),
            )
            logger.info(
                "qdrant_collection_created",
                collection=collection_name,
                dimension=dimension,
            )
        else:
            logger.info("qdrant_collection_exists", collection=collection_name)
