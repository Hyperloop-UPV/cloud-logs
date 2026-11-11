"""Unit tests for Google Drive integration service and monthly folder organization."""

import asyncio
import json
import tempfile
from datetime import UTC, datetime
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

from app.core.gdrive import (
    GoogleDriveService,
    get_gdrive_service,
    get_year_month_folder,
)


class TestGoogleDriveService(IsolatedAsyncioTestCase):
    def test_get_year_month_folder(self):
        # Specific date
        dt = datetime(2026, 10, 23, 15, 30, tzinfo=UTC)
        self.assertEqual(get_year_month_folder(dt), "2026_10")

        # January leading zero
        dt_jan = datetime(2027, 1, 5, tzinfo=UTC)
        self.assertEqual(get_year_month_folder(dt_jan), "2027_01")

        # December
        dt_dec = datetime(2026, 12, 31, 23, 59, tzinfo=UTC)
        self.assertEqual(get_year_month_folder(dt_dec), "2026_12")

        # None defaults to current UTC year_month
        now_expected = datetime.now(UTC).strftime("%Y_%m")
        self.assertEqual(get_year_month_folder(None), now_expected)

    def test_service_initialization_defaults(self):
        service = GoogleDriveService(
            service_account_path="/nonexistent/creds.json", simulation_mode=False
        )
        self.assertFalse(service.has_credentials)
        self.assertFalse(service.simulation_mode)
        self.assertIsInstance(service._folder_lock, asyncio.Lock)
        self.assertIsInstance(service._token_lock, asyncio.Lock)

    async def test_non_simulation_mode_raises_503_when_credentials_missing(self):
        """Simulation mode is NOT a fallback: when disabled and no credentials exist, it must fail explicitly."""
        service = GoogleDriveService(service_account_path="", simulation_mode=False)
        log_id = uuid4()

        with self.assertRaises(HTTPException) as cm_folder:
            await service.get_or_create_monthly_folder("2026_10")
        self.assertEqual(cm_folder.exception.status_code, 503)

        with self.assertRaises(HTTPException) as cm_session:
            await service.create_resumable_upload_session(
                "test.zip", 1000, "2026_10", log_id
            )
        self.assertEqual(cm_session.exception.status_code, 503)

        with self.assertRaises(HTTPException) as cm_verify:
            await service.verify_uploaded_file(
                log_id, "test.zip", "2026_10", "drive_123"
            )
        self.assertEqual(cm_verify.exception.status_code, 503)

    async def test_explicit_simulation_mode_folder_creation(self):
        """Simulation mode operates only when explicitly enabled."""
        service = GoogleDriveService(service_account_path="", simulation_mode=True)
        folder_id = await service.get_or_create_monthly_folder("2026_10")
        self.assertEqual(folder_id, "mock_folder_2026_10")

    async def test_explicit_simulation_mode_create_upload_session(self):
        service = GoogleDriveService(service_account_path="", simulation_mode=True)
        log_id = uuid4()
        upload_url, drive_file_id = await service.create_resumable_upload_session(
            file_name="telemetry.zip",
            file_size=1048576,
            folder_name="2026_10",
            log_id=log_id,
        )
        self.assertIn("uploadType=resumable", upload_url)
        self.assertIn(str(log_id), upload_url)
        self.assertIn("folder=2026_10", upload_url)
        self.assertIsNone(drive_file_id)

    async def test_explicit_simulation_mode_verify_uploaded_file(self):
        service = GoogleDriveService(service_account_path="", simulation_mode=True)
        log_id = uuid4()
        res = await service.verify_uploaded_file(
            log_id=log_id,
            file_name="telemetry.zip",
            folder_name="2026_10",
            drive_file_id="custom_fid_123",
        )
        self.assertTrue(res["verified"])
        self.assertEqual(res["drive_file_id"], "custom_fid_123")
        self.assertEqual(
            res["drive_url"],
            "https://drive.google.com/file/d/custom_fid_123/view",
        )

    def test_dependency_provider(self):
        service = get_gdrive_service()
        self.assertIsInstance(service, GoogleDriveService)

    async def test_real_oauth_token_exchange_and_cache(self):
        """Verify JWT generation and token exchange with Google OAuth token endpoint."""
        pk = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = pk.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("utf-8")

        with tempfile.NamedTemporaryFile("w+", suffix=".json") as f:
            json.dump(
                {
                    "type": "service_account",
                    "client_email": "test-sa@hyperloop.iam.gserviceaccount.com",
                    "private_key": pem,
                    "token_uri": "https://oauth2.googleapis.com/token",
                },
                f,
            )
            f.flush()

            service = GoogleDriveService(
                service_account_path=f.name, simulation_mode=False
            )
            self.assertTrue(service.has_credentials)

            mock_client = AsyncMock()
            mock_client.__aenter__.return_value = mock_client
            mock_client.post.return_value = httpx.Response(
                200, json={"access_token": "ya29.mock_token_123", "expires_in": 3600}
            )

            with patch("httpx.AsyncClient", return_value=mock_client):
                # 1. Fetch token first time
                tok = await service._get_access_token()
                self.assertEqual(tok, "ya29.mock_token_123")
                self.assertEqual(mock_client.post.call_count, 1)

                # 2. Subsequent call returns cached token without HTTP request
                tok_cached = await service._get_access_token()
                self.assertEqual(tok_cached, "ya29.mock_token_123")
                self.assertEqual(mock_client.post.call_count, 1)

    async def test_real_oauth_token_exchange_failure(self):
        """When Google OAuth returns HTTP 400/401, raise 502 Bad Gateway."""
        pk = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = pk.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("utf-8")

        with tempfile.NamedTemporaryFile("w+", suffix=".json") as f:
            json.dump(
                {
                    "client_email": "test-sa@hyperloop.iam.gserviceaccount.com",
                    "private_key": pem,
                },
                f,
            )
            f.flush()

            service = GoogleDriveService(
                service_account_path=f.name, simulation_mode=False
            )
            mock_client = AsyncMock()
            mock_client.__aenter__.return_value = mock_client
            mock_client.post.return_value = httpx.Response(400, text="invalid_grant")

            with patch("httpx.AsyncClient", return_value=mock_client):
                with self.assertRaises(HTTPException) as cm:
                    await service._get_access_token()
                self.assertEqual(cm.exception.status_code, 502)

    async def test_real_folder_get_existing_and_create_new(self):
        """Test finding existing monthly folder and creating new if not found."""
        service = GoogleDriveService(simulation_mode=False)
        service._access_token = "mock_tok"
        service._token_expires_at = 9999999999
        service.root_folder_id = "root_parent_id"

        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client

        with (
            patch.object(GoogleDriveService, "has_credentials", True),
            patch("httpx.AsyncClient", return_value=mock_client),
        ):
            # 1. Folder exists
            mock_client.get.return_value = httpx.Response(
                200, json={"files": [{"id": "existing_folder_id", "name": "2026_10"}]}
            )
            fid = await service.get_or_create_monthly_folder("2026_10")
            self.assertEqual(fid, "existing_folder_id")

            # Cache check
            fid_cached = await service.get_or_create_monthly_folder("2026_10")
            self.assertEqual(fid_cached, "existing_folder_id")

            # 2. Folder does not exist -> creates it
            mock_client.get.return_value = httpx.Response(200, json={"files": []})
            mock_client.post.return_value = httpx.Response(
                201, json={"id": "new_created_folder_id", "name": "2026_11"}
            )
            fid_created = await service.get_or_create_monthly_folder("2026_11")
            self.assertEqual(fid_created, "new_created_folder_id")

    async def test_real_create_resumable_session(self):
        """Test initiating resumable upload session with Google Drive."""
        service = GoogleDriveService(simulation_mode=False)
        service._access_token = "mock_tok"
        service._token_expires_at = 9999999999
        service._folder_cache["2026_10"] = "folder_123"

        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.post.return_value = httpx.Response(
            200,
            headers={
                "Location": "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=real_id_999"
            },
        )

        with (
            patch.object(GoogleDriveService, "has_credentials", True),
            patch("httpx.AsyncClient", return_value=mock_client),
        ):
            (
                upload_url,
                drive_file_id,
            ) = await service.create_resumable_upload_session(
                file_name="telemetry_flight.zip",
                file_size=2048,
                folder_name="2026_10",
                log_id=uuid4(),
            )
            self.assertIn("real_id_999", upload_url)
            self.assertIsNone(drive_file_id)

    async def test_real_verify_uploaded_file_by_id_and_query(self):
        """Test verifying uploaded file by explicit ID and by folder search."""
        service = GoogleDriveService(simulation_mode=False)
        service._access_token = "mock_tok"
        service._token_expires_at = 9999999999
        service._folder_cache["2026_10"] = "folder_123"

        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client

        with (
            patch.object(GoogleDriveService, "has_credentials", True),
            patch("httpx.AsyncClient", return_value=mock_client),
        ):
            # 1. By drive_file_id
            mock_client.get.return_value = httpx.Response(
                200,
                json={
                    "id": "file_abc_123",
                    "name": "telemetry.zip",
                    "size": "5000",
                    "webViewLink": "https://drive.google.com/file/d/file_abc_123/view",
                    "trashed": False,
                },
            )
            res_id = await service.verify_uploaded_file(
                log_id=uuid4(),
                file_name="telemetry.zip",
                folder_name="2026_10",
                drive_file_id="file_abc_123",
            )
            self.assertTrue(res_id["verified"])
            self.assertEqual(res_id["file_size"], 5000)

            # 2. By search query in folder
            mock_client.get.return_value = httpx.Response(
                200,
                json={
                    "files": [
                        {
                            "id": "queried_file_id",
                            "name": "telemetry.zip",
                            "size": "10000",
                            "webViewLink": "https://drive.google.com/file/d/queried_file_id/view",
                            "trashed": False,
                        }
                    ]
                },
            )
            res_query = await service.verify_uploaded_file(
                log_id=uuid4(),
                file_name="telemetry.zip",
                folder_name="2026_10",
                drive_file_id=None,
            )
            self.assertTrue(res_query["verified"])
            self.assertEqual(res_query["drive_file_id"], "queried_file_id")
            self.assertEqual(res_query["file_size"], 10000)

            # 3. Not found
            mock_client.get.return_value = httpx.Response(200, json={"files": []})
            res_missing = await service.verify_uploaded_file(
                log_id=uuid4(),
                file_name="missing.zip",
                folder_name="2026_10",
                drive_file_id=None,
            )
            self.assertFalse(res_missing["verified"])

    async def test_concurrent_get_access_token_uses_lock(self):
        """Concurrent calls to _get_access_token only exchange OAuth credentials once."""
        pk = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = pk.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("utf-8")

        with tempfile.NamedTemporaryFile("w+", suffix=".json") as f:
            json.dump(
                {
                    "client_email": "test-sa@hyperloop.iam.gserviceaccount.com",
                    "private_key": pem,
                    "token_uri": "https://oauth2.googleapis.com/token",
                },
                f,
            )
            f.flush()

            service = GoogleDriveService(
                service_account_path=f.name, simulation_mode=False
            )
            mock_client = AsyncMock()
            mock_client.__aenter__.return_value = mock_client

            async def mock_post(*args, **kwargs):
                await asyncio.sleep(0.01)
                return httpx.Response(
                    200, json={"access_token": "ya29.concurrency_token", "expires_in": 3600}
                )

            mock_client.post.side_effect = mock_post

            with patch("httpx.AsyncClient", return_value=mock_client):
                # Run multiple requests concurrently
                tokens = await asyncio.gather(
                    service._get_access_token(),
                    service._get_access_token(),
                    service._get_access_token(),
                )
                self.assertEqual(
                    tokens,
                    [
                        "ya29.concurrency_token",
                        "ya29.concurrency_token",
                        "ya29.concurrency_token",
                    ],
                )
                # Due to double-checked locking, only 1 HTTP call should have been made
                self.assertEqual(mock_client.post.call_count, 1)

    async def test_concurrent_get_or_create_monthly_folder_uses_lock(self):
        """Concurrent calls to get_or_create_monthly_folder only create the folder once."""
        service = GoogleDriveService(simulation_mode=False)
        service._access_token = "mock_tok"
        service._token_expires_at = 9999999999
        service.root_folder_id = "root_parent_id"

        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client

        async def mock_get(*args, **kwargs):
            await asyncio.sleep(0.01)
            # Folder does not exist on initial query
            return httpx.Response(200, json={"files": []})

        async def mock_post(*args, **kwargs):
            await asyncio.sleep(0.01)
            return httpx.Response(
                201, json={"id": "concurrent_created_folder_id", "name": "2026_12"}
            )

        mock_client.get.side_effect = mock_get
        mock_client.post.side_effect = mock_post

        with (
            patch.object(GoogleDriveService, "has_credentials", True),
            patch("httpx.AsyncClient", return_value=mock_client),
        ):
            fids = await asyncio.gather(
                service.get_or_create_monthly_folder("2026_12"),
                service.get_or_create_monthly_folder("2026_12"),
                service.get_or_create_monthly_folder("2026_12"),
            )
            self.assertEqual(
                fids,
                [
                    "concurrent_created_folder_id",
                    "concurrent_created_folder_id",
                    "concurrent_created_folder_id",
                ],
            )
            # Only 1 create request should have been made thanks to folder lock & cache
            self.assertEqual(mock_client.post.call_count, 1)
