from fastapi import Request
from fastapi.responses import JSONResponse

from app.core.exceptions import AppException
from app.core.responses import error_response
from app.config.logging import logger


async def app_exception_handler(_request: Request, exc: AppException) -> JSONResponse:
    logger.error(
        "application_error",
        code=exc.code,
        message=exc.message,
        status_code=exc.status_code,
    )
    response = error_response(exc.code, exc.message, exc.details)
    return JSONResponse(status_code=exc.status_code, content=response.model_dump())


async def generic_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled_error", error=str(exc))
    response = error_response("INTERNAL_ERROR", "An unexpected error occurred")
    return JSONResponse(status_code=500, content=response.model_dump())
