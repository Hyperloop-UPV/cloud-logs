"""GitHub OAuth client and API integration."""

from __future__ import annotations

import logging
import urllib.parse
from typing import Any

import httpx
from fastapi import HTTPException, status

from app.config import settings

logger = logging.getLogger("cloud_logs.github")


def get_github_auth_url(state: str) -> str:
    """Generate GitHub OAuth authorization URL with client ID and requested scopes."""
    params = {
        "client_id": settings.github_client_id,
        "redirect_uri": settings.github_redirect_uri,
        "scope": "read:user,read:org",
        "state": state,
    }
    return f"https://github.com/login/oauth/authorize?{urllib.parse.urlencode(params)}"


async def exchange_code_for_token(code: str) -> str:
    """Exchange temporary authorization code for GitHub access token."""
    payload = {
        "client_id": settings.github_client_id,
        "client_secret": settings.github_client_secret,
        "code": code,
        "redirect_uri": settings.github_redirect_uri,
    }
    headers = {"Accept": "application/json"}

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            "https://github.com/login/oauth/access_token",
            json=payload,
            headers=headers,
        )

    if response.status_code != 200:
        logger.error(
            "GitHub OAuth token exchange failed with HTTP %d: %s",
            response.status_code,
            response.text,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to exchange GitHub authorization code",
        )

    data = response.json()
    if "error" in data:
        error_desc = data.get("error_description", data.get("error"))
        logger.error("GitHub OAuth returned error: %s", error_desc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"GitHub OAuth error: {error_desc}",
        )

    token = data.get("access_token")
    if not token:
        logger.error("GitHub OAuth response did not contain access_token: %s", data)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GitHub OAuth response did not contain access_token",
        )

    return token


async def get_github_user_profile(gh_token: str) -> dict[str, Any]:
    """Retrieve authenticated user's profile from GitHub API."""
    headers = {
        "Authorization": f"Bearer {gh_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Hyperloop-Cloud-Logs",
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get("https://api.github.com/user", headers=headers)

    if response.status_code != 200:
        logger.error(
            "Failed to fetch GitHub profile: HTTP %d %s",
            response.status_code,
            response.text,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to retrieve GitHub user profile",
        )

    return response.json()


async def check_github_org_membership(
    gh_token: str,
    org_name: str | None = None,
) -> bool:
    """Check if authenticated user belongs to the specified GitHub organization.

    If org_name (or settings.github_org_name) is None or empty, allows any user.
    """
    target_org = org_name if org_name is not None else settings.github_org_name
    if not target_org:
        return True

    headers = {
        "Authorization": f"Bearer {gh_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Hyperloop-Cloud-Logs",
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get("https://api.github.com/user/orgs?per_page=100", headers=headers)

    if response.status_code != 200:
        logger.warning(
            "Failed to fetch user organizations from GitHub: HTTP %d %s",
            response.status_code,
            response.text,
        )
        return False

    orgs = response.json()
    if not isinstance(orgs, list):
        return False

    target_org_lower = target_org.strip().lower()
    for org in orgs:
        if isinstance(org, dict):
            login = org.get("login", "")
            if login.strip().lower() == target_org_lower:
                return True

    return False


__all__ = [
    "check_github_org_membership",
    "exchange_code_for_token",
    "get_github_auth_url",
    "get_github_user_profile",
]
