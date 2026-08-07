from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    app_name: str = "AMASS Agents"
    app_version: str = "0.1.0"
    environment: str = "development"
    debug: bool = False

    # Server
    agents_host: str = "0.0.0.0"
    agents_port: int = 8000

    # Database
    database_url: str = "postgresql://amass:amass_secret@postgres:5432/amass"

    # Redis
    redis_url: str = "redis://:redis_secret@redis:6379"
    redis_prefix: str = "amass:"

    # Qdrant
    qdrant_url: str = "http://qdrant:6333"
    qdrant_api_key: str = ""
    qdrant_collection_name: str = "amass_embeddings"
    embedding_dimension: int = 1536

    # Backend API
    backend_url: str = "http://backend:3001"

    # Logging
    log_level: str = "info"
    log_format: str = "json"

    # LLM (Future)
    openai_api_key: str = ""
    llm_model: str = "gpt-4o"
    embedding_model: str = "text-embedding-3-small"


@lru_cache
def get_settings() -> Settings:
    return Settings()
