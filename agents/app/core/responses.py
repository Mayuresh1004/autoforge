from datetime import datetime, timezone
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class ApiError(BaseModel):
    code: str
    message: str
    details: Any | None = None


class ApiResponse(BaseModel, Generic[T]):
    success: bool
    data: T | None = None
    error: ApiError | None = None
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


def success_response(data: T) -> ApiResponse[T]:
    return ApiResponse(success=True, data=data, error=None)


def error_response(code: str, message: str, details: Any | None = None) -> ApiResponse[None]:
    return ApiResponse(
        success=False,
        data=None,
        error=ApiError(code=code, message=message, details=details),
    )
