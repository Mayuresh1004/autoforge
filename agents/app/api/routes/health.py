from fastapi import APIRouter

from app.core.responses import success_response, ApiResponse
from app.services.health_service import HealthService, VersionService

router = APIRouter()
health_service = HealthService()
version_service = VersionService()


@router.get("/", response_model=ApiResponse)
async def root():
    return success_response(version_service.get_info())


@router.get("/health", response_model=ApiResponse)
async def health():
    health_data = await health_service.check()
    return success_response(health_data)


@router.get("/version", response_model=ApiResponse)
async def version():
    return success_response(version_service.get_version())
