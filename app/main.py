import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, Request, Response, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy import text

import app.models  # Ensure all models are registered on Base.metadata
from app.api.v1 import api_router
from app.config import settings
from app.db.base import Base
from app.db.engine import engine

# Logging configuration
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("cloud_logs")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan: initialize database schema and handle engine teardown."""
    logger.info("Initializing Hyperloop Cloud-Logs API [%s mode]", settings.environment)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield

    logger.info("Shutting down Cloud-Logs API: disposing database engine pool")
    await engine.dispose()



app = FastAPI(
    title="Cloud Logs API",
    description="Telemetry and log catalog management service.",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/docs", include_in_schema=False)
async def custom_swagger_ui_html(request: Request) -> HTMLResponse:
    """Serve Swagger UI dynamically supporting both direct access and reverse proxy prefixes."""
    return get_swagger_ui_html(
        openapi_url="openapi.json",
        title="Hyperloop UPV - Cloud Logs API Docs",
        oauth2_redirect_url=app.swagger_ui_oauth2_redirect_url,
    )


@app.get("/redoc", include_in_schema=False)
async def custom_redoc_html(request: Request) -> HTMLResponse:
    """Serve ReDoc dynamically supporting both direct access and reverse proxy prefixes."""
    return get_redoc_html(
        openapi_url="openapi.json",
        title="Hyperloop UPV - Cloud Logs API ReDoc",
    )


@app.get("/openapi.json", include_in_schema=False)
@app.get("/docs/openapi.json", include_in_schema=False)
@app.get("/redoc/openapi.json", include_in_schema=False)
async def proxy_openapi() -> JSONResponse:
    """Endpoint serving openapi.json under root, relative and reverse proxy paths."""
    return JSONResponse(app.openapi())


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Format validation errors in a clean, consistent response."""
    logger.warning(
        "Validation error on %s %s: %s", request.method, request.url.path, exc.errors()
    )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": "Validation Error",
            "detail": jsonable_encoder(exc.errors()),
            "path": request.url.path,
            "timestamp": datetime.now(UTC).isoformat(),
        },
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all unhandled exception handler to avoid raw stacktraces in responses."""
    logger.error(
        "Unhandled error on %s %s: %s",
        request.method,
        request.url.path,
        exc,
        exc_info=exc,
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "Internal Server Error",
            "message": "An unexpected error occurred. Please contact the administrator.",
            "timestamp": datetime.now(UTC).isoformat(),
        },
    )


@app.get("/", tags=["System"])
async def root() -> dict[str, str]:
    """Root endpoint with service identity."""
    return {
        "service": "Cloud-Logs API",
        "version": "1.0.0",
        "status": "online",
        "docs": "/docs",
    }


@app.get("/health", tags=["System"])
@app.get("/api/v1/health", tags=["System"])
async def health_check(response: Response) -> dict[str, Any]:
    """Health check endpoint for Docker, reverse proxies and orchestrators."""
    db_status = "connected"
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as e:  # noqa: BLE001 - DB probe error marks health status degraded
        logger.warning("Healthcheck DB ping failed: %s", e)
        db_status = f"unhealthy: {e!s}"

    is_healthy = db_status == "connected"
    if not is_healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {
        "status": "healthy" if is_healthy else "degraded",
        "environment": settings.environment,
        "components": {
            "database": db_status,
        },
        "timestamp": datetime.now(UTC).isoformat(),
    }


# Include API v1 router
app.include_router(api_router, prefix="/api/v1")
