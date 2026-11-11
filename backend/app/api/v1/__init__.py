"""API v1 router registry."""

from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.logs import router as logs_router
from app.api.v1.users import router as users_router

api_router = APIRouter()
api_router.include_router(auth_router, prefix="/auth")
api_router.include_router(logs_router, prefix="/logs")
api_router.include_router(users_router)

__all__ = ["api_router", "auth_router", "logs_router", "users_router"]
