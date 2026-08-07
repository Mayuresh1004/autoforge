from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config.settings import get_settings
from app.config.logging import logger
from app.core.exceptions import AppException
from app.middleware.error_handler import app_exception_handler, generic_exception_handler
from app.api.routes.health import router as health_router
from app.services.qdrant_service import QdrantService


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info(
        "agents_service_starting",
        host=settings.agents_host,
        port=settings.agents_port,
        environment=settings.environment,
    )

    qdrant = QdrantService()
    try:
        qdrant.ensure_collection()
    except Exception as e:
        logger.warning("qdrant_init_deferred", error=str(e))

    yield

    logger.info("agents_service_shutting_down")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="AMASS AI Agents Service - Autonomous security agent orchestration",
        lifespan=lifespan,
        docs_url="/docs" if settings.environment != "production" else None,
        redoc_url="/redoc" if settings.environment != "production" else None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if settings.debug else ["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.add_exception_handler(AppException, app_exception_handler)
    app.add_exception_handler(Exception, generic_exception_handler)

    app.include_router(health_router)

    # Future agent route modules:
    # app.include_router(scout_router, prefix="/agents/scout", tags=["Scout Agent"])
    # app.include_router(sniper_router, prefix="/agents/sniper", tags=["Sniper Agent"])
    # app.include_router(engineer_router, prefix="/agents/engineer", tags=["Engineer Agent"])
    # app.include_router(critic_router, prefix="/agents/critic", tags=["Critic Agent"])

    return app
