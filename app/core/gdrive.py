"""Google Drive integration module: monthly folder organization and resumable uploads."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

import httpx
import jwt
from fastapi import HTTPException, status

from app.config import settings

logger = logging.getLogger("cloud_logs.gdrive")


def get_year_month_folder(dt: datetime | None = None) -> str:
    """Return YYYY_MM folder string (e.g. '2026_10') based on date or current UTC time."""
    target_dt = dt or datetime.now(UTC)
    return target_dt.strftime("%Y_%m")


class GoogleDriveService:
    """Service managing Google Drive monthly subfolders and resumable uploads."""

    def __init__(
        self,
        root_folder_id: str | None = None,
        service_account_path: str | None = None,
        simulation_mode: bool | None = None,
    ) -> None:
        self.root_folder_id = (
            root_folder_id
            if root_folder_id is not None
            else settings.gdrive_root_folder_id
        )
        self.service_account_path = (
            service_account_path
            if service_account_path is not None
            else settings.gdrive_service_account_path
        )
        self.simulation_mode = (
            simulation_mode
            if simulation_mode is not None
            else settings.gdrive_simulation_mode
        )
        self._access_token: str | None = None
        self._token_expires_at: float = 0.0
        self._folder_cache: dict[str, str] = {}
        self._folder_lock = asyncio.Lock()
        self._token_lock = asyncio.Lock()

    @property
    def has_credentials(self) -> bool:
        """Check if service account credentials file exists and is valid."""
        if not self.service_account_path:
            return False
        return Path(self.service_account_path).is_file()

    async def _get_access_token(self) -> str:
        """Retrieve or refresh Google OAuth2 access token for the service account."""
        if not self.has_credentials:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Google Drive is not configured: service account credentials file missing and simulation mode is disabled.",
            )

        now = datetime.now(UTC).timestamp()
        if self._access_token and now < (self._token_expires_at - 60):
            return self._access_token

        async with self._token_lock:
            now = datetime.now(UTC).timestamp()
            if self._access_token and now < (self._token_expires_at - 60):
                return self._access_token

            try:
                sa_info = json.loads(
                    Path(self.service_account_path).read_text(encoding="utf-8")
                )

                client_email = sa_info.get("client_email")
                private_key = sa_info.get("private_key")
                token_uri = sa_info.get("token_uri", "https://oauth2.googleapis.com/token")

                if not client_email or not private_key:
                    raise ValueError(
                        "Service account JSON missing client_email or private_key"
                    )

                now_int = int(now)
                payload = {
                    "iss": client_email,
                    "scope": "https://www.googleapis.com/auth/drive",
                    "aud": token_uri,
                    "exp": now_int + 3600,
                    "iat": now_int,
                }

                assertion = jwt.encode(payload, private_key, algorithm="RS256")

                async with httpx.AsyncClient(timeout=15.0) as client:
                    resp = await client.post(
                        token_uri,
                        data={
                            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                            "assertion": assertion,
                        },
                    )

                if resp.status_code != 200:
                    logger.error(
                        "Failed to acquire Google Drive OAuth token: %d %s",
                        resp.status_code,
                        resp.text,
                    )
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail=f"Google OAuth authentication failed: {resp.text}",
                    )

                token_data = resp.json()
                self._access_token = token_data["access_token"]
                expires_in = token_data.get("expires_in", 3600)
                self._token_expires_at = now + expires_in
                return self._access_token

            except HTTPException:
                raise
            except (ValueError, KeyError, jwt.PyJWTError, httpx.HTTPError) as e:
                logger.error(
                    "Error signing or exchanging Google service account credentials: %s", e
                )
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Error authenticating with Google Drive: {e!s}",
                ) from e

    async def get_or_create_monthly_folder(self, folder_name: str) -> str:
        """Find or create the monthly subfolder (YYYY_MM) in Google Drive root."""
        if self.simulation_mode:
            logger.info(
                "Explicit simulation mode active: mock folder '%s'", folder_name
            )
            return f"mock_folder_{folder_name}"

        async with self._folder_lock:
            if folder_name in self._folder_cache:
                return self._folder_cache[folder_name]

            token = await self._get_access_token()
            headers = {"Authorization": f"Bearer {token}"}
            query = (
                f"name = '{folder_name}' and "
                f"mimeType = 'application/vnd.google-apps.folder' and "
                f"trashed = false"
            )
            if self.root_folder_id:
                query += f" and '{self.root_folder_id}' in parents"

            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(
                    "https://www.googleapis.com/drive/v3/files",
                    headers=headers,
                    params={
                        "q": query,
                        "fields": "files(id, name)",
                        "supportsAllDrives": "true",
                        "includeItemsFromAllDrives": "true",
                    },
                )
                if resp.status_code == 200:
                    files = resp.json().get("files", [])
                    if files:
                        folder_id = files[0]["id"]
                        self._folder_cache[folder_name] = folder_id
                        return folder_id

                # If folder doesn't exist, create it
                create_payload: dict[str, Any] = {
                    "name": folder_name,
                    "mimeType": "application/vnd.google-apps.folder",
                }
                if self.root_folder_id:
                    create_payload["parents"] = [self.root_folder_id]

                create_resp = await client.post(
                    "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true",
                    headers=headers,
                    json=create_payload,
                )
                if create_resp.status_code in (200, 201):
                    created_id = create_resp.json()["id"]
                    self._folder_cache[folder_name] = created_id
                    return created_id

                logger.error(
                    "Failed to create monthly folder in Google Drive: %d %s",
                    create_resp.status_code,
                    create_resp.text,
                )
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Failed to create monthly folder in Google Drive",
                )

    async def create_resumable_upload_session(
        self,
        file_name: str,
        file_size: int,
        folder_name: str,
        log_id: UUID,
    ) -> tuple[str, str | None]:
        """Create a Google Drive resumable upload session for the file.

        Returns:
            tuple[str, str | None]: (upload_url, drive_file_id)
        """
        if self.simulation_mode:
            upload_url = (
                f"https://www.googleapis.com/upload/drive/v3/files?"
                f"uploadType=resumable&upload_id={log_id}&folder={folder_name}"
            )
            return upload_url, None

        token = await self._get_access_token()
        folder_id = await self.get_or_create_monthly_folder(folder_name)

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": "application/zip",
            "X-Upload-Content-Length": str(file_size),
        }
        metadata: dict[str, Any] = {
            "name": file_name,
            "description": f"Hyperloop telemetry log ID: {log_id}",
            "parents": [folder_id],
        }

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
                headers=headers,
                json=metadata,
            )
            if resp.status_code == 200:
                location = resp.headers.get("Location")
                if location:
                    return location, None

            logger.error(
                "Google Drive API returned %d when creating upload session: %s",
                resp.status_code,
                resp.text,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Google Drive failed to create upload session: {resp.text}",
            )

    async def verify_uploaded_file(
        self,
        log_id: UUID,
        file_name: str,
        folder_name: str,
        drive_file_id: str | None = None,
    ) -> dict[str, Any]:
        """Verify uploaded file existence and metadata in Google Drive.

        Returns:
            dict containing:
                - verified: bool
                - drive_file_id: str
                - drive_url: str
                - file_size: int | None
        """
        if self.simulation_mode:
            target_file_id = drive_file_id or f"gdrive_{log_id}"
            default_drive_url = f"https://drive.google.com/file/d/{target_file_id}/view"
            return {
                "verified": True,
                "drive_file_id": target_file_id,
                "drive_url": default_drive_url,
                "file_size": None,
            }

        token = await self._get_access_token()
        headers = {"Authorization": f"Bearer {token}"}

        async with httpx.AsyncClient(timeout=15.0) as client:
            if drive_file_id:
                resp = await client.get(
                    f"https://www.googleapis.com/drive/v3/files/{drive_file_id}",
                    headers=headers,
                    params={
                        "fields": "id,name,size,webViewLink,trashed",
                        "supportsAllDrives": "true",
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if not data.get("trashed", False):
                        return {
                            "verified": True,
                            "drive_file_id": data["id"],
                            "drive_url": data.get(
                                "webViewLink",
                                f"https://drive.google.com/file/d/{data['id']}/view",
                            ),
                            "file_size": int(data["size"]) if "size" in data else None,
                        }
            else:
                # Search by file name in folder
                folder_id = await self.get_or_create_monthly_folder(folder_name)
                safe_name = file_name.replace("'", "\\'")
                query = f"name = '{safe_name}' and '{folder_id}' in parents and trashed = false"
                resp = await client.get(
                    "https://www.googleapis.com/drive/v3/files",
                    headers=headers,
                    params={
                        "q": query,
                        "fields": "files(id,name,size,webViewLink,trashed)",
                        "supportsAllDrives": "true",
                        "includeItemsFromAllDrives": "true",
                    },
                )
                if resp.status_code == 200:
                    files = resp.json().get("files", [])
                    if files:
                        f = files[0]
                        return {
                            "verified": True,
                            "drive_file_id": f["id"],
                            "drive_url": f.get(
                                "webViewLink",
                                f"https://drive.google.com/file/d/{f['id']}/view",
                            ),
                            "file_size": int(f["size"]) if "size" in f else None,
                        }

        return {
            "verified": False,
            "drive_file_id": drive_file_id or f"gdrive_{log_id}",
            "drive_url": f"https://drive.google.com/file/d/{drive_file_id or f'gdrive_{log_id}'}/view",
            "file_size": None,
        }


gdrive_service = GoogleDriveService()


def get_gdrive_service() -> GoogleDriveService:
    """Dependency provider for GoogleDriveService."""
    return gdrive_service


__all__ = [
    "GoogleDriveService",
    "gdrive_service",
    "get_gdrive_service",
    "get_year_month_folder",
]
