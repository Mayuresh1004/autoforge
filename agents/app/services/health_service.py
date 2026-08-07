import time
from typing import Any

import httpx
import redis.asyncio as aioredis
from qdrant_client import QdrantClient
from app.config.settings import get_settings
from app.config.logging import logger


class HealthService:
    def __init__(self) -> None:
        self._start_time = time.time()
        self._settings = get_settings()

    def get_uptime(self) -> int:
        return int(time.time() - self._start_time)

    async def check(self) -> dict[str, Any]:
        checks: dict[str, dict[str, Any]] = {}

        checks["redis"] = await self._check_redis()
        checks["qdrant"] = await self._check_qdrant()
        checks["backend"] = await self._check_backend()

        statuses = [c["status"] for c in checks.values()]
        if all(s == "up" for s in statuses):
            status = "healthy"
        elif any(s == "down" for s in statuses):
            status = "unhealthy" if statuses.count("down") > 1 else "degraded"
        else:
            status = "degraded"

        return {
            "status": status,
            "service": self._settings.app_name,
            "version": self._settings.app_version,
            "uptime": self.get_uptime(),
            "checks": checks,
        }

    async def _check_redis(self) -> dict[str, Any]:
        start = time.time()
        try:
            client = aioredis.from_url(self._settings.redis_url)
            await client.ping()
            await client.aclose()
            return {"status": "up", "latency_ms": int((time.time() - start) * 1000)}
        except Exception as e:
            return {
                "status": "down",
                "latency_ms": int((time.time() - start) * 1000),
                "message": str(e),
            }

    async def _check_qdrant(self) -> dict[str, Any]:
        start = time.time()
        try:
            client = QdrantClient(
                url=self._settings.qdrant_url,
                api_key=self._settings.qdrant_api_key or None,
            )
            client.get_collections()
            return {"status": "up", "latency_ms": int((time.time() - start) * 1000)}
        except Exception as e:
            return {
                "status": "down",
                "latency_ms": int((time.time() - start) * 1000),
                "message": str(e),
            }

    async def _check_backend(self) -> dict[str, Any]:
        start = time.time()
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self._settings.backend_url}/health")
                if response.status_code >= 500:
                    raise ConnectionError(f"Backend returned {response.status_code}")
            return {"status": "up", "latency_ms": int((time.time() - start) * 1000)}
        except Exception as e:
            return {
                "status": "down",
                "latency_ms": int((time.time() - start) * 1000),
                "message": str(e),
            }


class VersionService:
    def __init__(self) -> None:
        self._settings = get_settings()

    def get_version(self) -> dict[str, str]:
        return {
            "name": self._settings.app_name,
            "version": self._settings.app_version,
            "environment": self._settings.environment,
        }

    def get_info(self) -> dict[str, str]:
        return {
            **self.get_version(),
            "description": "AMASS AI Agents Service - LangGraph orchestration layer",
        }
