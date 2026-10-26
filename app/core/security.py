"""Security and cryptographic utilities for authentication and authorization."""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from fastapi import Request

from app.config import settings

logger = logging.getLogger("cloud_logs.security")


def create_access_token(
    user_id_or_data: uuid.UUID | str | dict[str, Any] | None = None,
    username: str | None = None,
    *,
    data: dict[str, Any] | None = None,
    expires_delta: timedelta | None = None,
    role: str | None = None,
    permissions: list[str] | None = None,
) -> str:
    """Create a signed JWT access token.

    Supports both dictionary payload or individual user_id/username arguments.
    """
    if isinstance(user_id_or_data, dict):
        payload: dict[str, Any] = user_id_or_data.copy()
    else:
        payload = data.copy() if data else {}
        if user_id_or_data is not None:
            payload["sub"] = str(user_id_or_data)

    if username is not None:
        payload["username"] = username

    if role is not None:
        payload["role"] = role
        payload.setdefault("permissions", [role])
    elif permissions is not None:
        payload["permissions"] = permissions
        payload.setdefault("role", "admin" if "admin" in permissions else "user")
    elif "role" in payload:
        payload.setdefault("permissions", [payload["role"]])
    elif "permissions" in payload:
        payload.setdefault("role", "admin" if "admin" in payload["permissions"] else "user")
    else:
        payload.setdefault("role", "user")
        payload.setdefault("permissions", ["user"])

    now = datetime.now(UTC)
    if expires_delta is not None:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.access_token_expire_minutes)

    payload.setdefault("type", "access")
    payload.setdefault("iat", now)
    payload.setdefault("exp", expire)

    return jwt.encode(
        payload,
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode and validate a JWT access token.

    Raises:
        jwt.ExpiredSignatureError: If token has expired.
        jwt.PyJWTError: If token is invalid or malformed.
    """
    if not token:
        raise jwt.InvalidTokenError("Empty token")

    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[settings.jwt_algorithm],
    )


def generate_random_token(nbytes: int = 32) -> str:
    """Generate a cryptographically secure URL-safe random string."""
    return secrets.token_urlsafe(nbytes)


generate_refresh_token = generate_random_token


def hash_token(token: str) -> str:
    """Compute SHA-256 hex digest of a token."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def get_refresh_token_expiry() -> datetime:
    """Calculate refresh token expiration date (90 days default)."""
    return datetime.now(UTC) + timedelta(
        days=settings.refresh_token_expire_days
    )


def verify_master_key(candidate: str) -> bool:
    """Verify an incoming API key against configured master API key in constant time."""
    if not candidate:
        return False

    clean_candidate = candidate.strip()

    # Compare directly against master_api_key if configured
    master_key = getattr(settings, "master_api_key", None)
    if master_key and hmac.compare_digest(clean_candidate, master_key):
        return True

    # Compare SHA-256 hash against master_api_key_hash
    master_hash = getattr(settings, "master_api_key_hash", None)
    if master_hash:
        candidate_hash = hash_token(clean_candidate)
        if hmac.compare_digest(candidate_hash, master_hash):
            return True

    return False


def log_master_key_usage(request: Request) -> None:
    """Audit log warning for usage of the Master API Key."""
    forwarded = request.headers.get("x-forwarded-for")
    client_ip = (
        forwarded.split(",")[0].strip()
        if forwarded
        else (request.client.host if request.client else "unknown")
    )
    user_agent = request.headers.get("user-agent", "unknown")
    logger.warning(
        "Master API Key authenticated for %s %s from %s [User-Agent: %s]",
        request.method,
        request.url.path,
        client_ip,
        user_agent,
        extra={
            "event": "master_api_key_authenticated",
            "http_method": request.method,
            "request_path": request.url.path,
            "client_ip": client_ip,
            "user_agent": user_agent,
        },
    )


__all__ = [
    "create_access_token",
    "decode_access_token",
    "generate_random_token",
    "generate_refresh_token",
    "get_refresh_token_expiry",
    "hash_token",
    "log_master_key_usage",
    "verify_master_key",
]
