"""Comprehensive unit and integration tests for medium_api_key functionality.

Verifies:
- Username parsing (plain, URL, @, query params)
- Key verification (plaintext and hash)
- AuthContext behavior with is_medium=True
- Dependency resolution via header, bearer, and query param
- Log creation (with existing user, missing user, non-existent user)
- Two-phase upload completion and abort
- Download authorization
- Strict enforcement of prohibitions (no modify, no delete, no cleanup, no user management)
"""

import uuid
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import status
from fastapi.testclient import TestClient

from app.config import settings
from app.core.gdrive import GoogleDriveService, get_gdrive_service
from app.core.github import parse_github_username
from app.core.security import hash_token, verify_medium_key
from app.dependencies import AuthContext, get_db
from app.main import app
from app.models.log import Log
from app.models.user import User


class TestParseGithubUsername(IsolatedAsyncioTestCase):
    def test_parse_plain_username(self):
        self.assertEqual(parse_github_username("octocat"), "octocat")
        self.assertEqual(parse_github_username("  Manel-Romero  "), "Manel-Romero")

    def test_parse_at_username(self):
        self.assertEqual(parse_github_username("@octocat"), "octocat")
        self.assertEqual(parse_github_username("@Manel-Romero"), "Manel-Romero")

    def test_parse_github_urls(self):
        self.assertEqual(parse_github_username("https://github.com/octocat"), "octocat")
        self.assertEqual(
            parse_github_username("https://github.com/octocat/"), "octocat"
        )
        self.assertEqual(
            parse_github_username("http://github.com/Manel-Romero"), "Manel-Romero"
        )
        self.assertEqual(parse_github_username("github.com/octocat"), "octocat")
        self.assertEqual(
            parse_github_username("https://github.com/octocat?tab=repositories"),
            "octocat",
        )
        self.assertEqual(
            parse_github_username("https://github.com/octocat/repo-name"),
            "octocat",
        )

    def test_parse_empty_or_invalid(self):
        self.assertIsNone(parse_github_username(None))
        self.assertIsNone(parse_github_username(""))
        self.assertIsNone(parse_github_username("   "))
        self.assertIsNone(parse_github_username("https://github.com"))
        self.assertIsNone(parse_github_username("https://github.com/"))


class TestVerifyMediumKey(IsolatedAsyncioTestCase):
    def test_verify_plaintext_key(self):
        with (
            patch.object(settings, "medium_api_key", "test-medium-key"),
            patch.object(settings, "medium_api_key_hash", None),
        ):
            self.assertTrue(verify_medium_key("test-medium-key"))
            self.assertTrue(verify_medium_key("  test-medium-key  "))
            self.assertFalse(verify_medium_key("wrong-key"))
            self.assertFalse(verify_medium_key(""))

    def test_verify_hashed_key(self):
        key = "test-hash-key"
        key_hash = hash_token(key)
        with (
            patch.object(settings, "medium_api_key", None),
            patch.object(settings, "medium_api_key_hash", key_hash),
        ):
            self.assertTrue(verify_medium_key(key))
            self.assertFalse(verify_medium_key("wrong-key"))


class TestAuthContextMedium(IsolatedAsyncioTestCase):
    def test_medium_auth_context_properties(self):
        user = User(
            id=uuid.uuid4(),
            username="testuser",
            github_username="testuser",
            role="user",
        )
        ctx = AuthContext(user=user, is_medium=True)
        self.assertEqual(ctx.role, "medium")
        self.assertIn("upload", ctx.permissions)
        self.assertIn("download", ctx.permissions)
        self.assertTrue(ctx.has_permission("user"))
        self.assertTrue(ctx.has_permission("upload"))
        self.assertTrue(ctx.has_permission("download"))
        self.assertFalse(ctx.has_permission("admin"))
        self.assertFalse(ctx.has_role("admin"))


class TestMediumKeyEndpointsIntegration(IsolatedAsyncioTestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.medium_key = "test-valid-medium-api-key"
        self.user_id = uuid.uuid4()
        self.test_user = User(
            id=self.user_id,
            username="testuser",
            github_username="testuser",
            role="user",
        )
        app.dependency_overrides[get_gdrive_service] = lambda: GoogleDriveService(
            simulation_mode=True
        )

    def tearDown(self):
        app.dependency_overrides.clear()

    async def test_initiate_upload_with_user_in_payload(self):
        mock_db = AsyncMock()
        mock_db.add = MagicMock()

        # Mock user query result
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = self.test_user
        mock_db.execute.return_value = mock_result

        app.dependency_overrides[get_db] = lambda: mock_db

        with patch.object(settings, "medium_api_key", self.medium_key):
            response = self.client.post(
                "/api/v1/logs/initiate",
                headers={"Authorization": f"Bearer {self.medium_key}"},
                json={
                    "fileName": "test_run.zip",
                    "fileSize": 1024,
                    "user": "https://github.com/testuser",
                    "tags": ["sensor", "nav"],
                    "note": "Uploaded via medium API key",
                },
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            data = response.json()
            self.assertIn("uploadUrl", data)
            self.assertEqual(data["status"], "pending_upload")

            # Check that db.add was called with a Log created by self.test_user
            added_log = mock_db.add.call_args[0][0]
            self.assertIsInstance(added_log, Log)
            self.assertEqual(added_log.created_by, self.user_id)
            self.assertEqual(added_log.tags, ["sensor", "nav"])
            self.assertEqual(added_log.note, "Uploaded via medium API key")

    async def test_initiate_upload_with_x_user_header(self):
        mock_db = AsyncMock()
        mock_db.add = MagicMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = self.test_user
        mock_db.execute.return_value = mock_result

        app.dependency_overrides[get_db] = lambda: mock_db

        with patch.object(settings, "medium_api_key", self.medium_key):
            response = self.client.post(
                "/api/v1/logs/initiate",
                headers={
                    "X-API-Key": self.medium_key,
                    "X-User": "testuser",
                },
                json={
                    "fileName": "test_run.zip",
                    "fileSize": 2048,
                },
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            added_log = mock_db.add.call_args[0][0]
            self.assertEqual(added_log.created_by, self.user_id)

    async def test_initiate_upload_missing_user_returns_400(self):
        mock_db = AsyncMock()
        app.dependency_overrides[get_db] = lambda: mock_db

        with patch.object(settings, "medium_api_key", self.medium_key):
            response = self.client.post(
                "/api/v1/logs/initiate",
                headers={"Authorization": f"Bearer {self.medium_key}"},
                json={
                    "fileName": "test_run.zip",
                    "fileSize": 1024,
                },
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertIn("required", response.json()["detail"].lower())

    async def test_initiate_upload_user_not_found_returns_404(self):
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        app.dependency_overrides[get_db] = lambda: mock_db

        with patch.object(settings, "medium_api_key", self.medium_key):
            response = self.client.post(
                "/api/v1/logs/initiate",
                headers={"Authorization": f"Bearer {self.medium_key}"},
                json={
                    "fileName": "test_run.zip",
                    "fileSize": 1024,
                    "user": "nonexistent_github_user",
                },
            )
            self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
            self.assertIn("not found", response.json()["detail"].lower())

    async def test_complete_upload_success(self):
        mock_db = AsyncMock()
        log_id = uuid.uuid4()
        existing_log = Log(
            id=log_id,
            file_name="test.zip",
            status="pending_upload",
            drive_folder="2026_11",
            file_size=1024,
            created_by=self.user_id,
        )

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = existing_log
        mock_db.execute.return_value = mock_result

        app.dependency_overrides[get_db] = lambda: mock_db

        with patch.object(settings, "medium_api_key", self.medium_key):
            response = self.client.post(
                f"/api/v1/logs/{log_id}/complete",
                headers={"Authorization": f"Bearer {self.medium_key}"},
                json={"fileHash": "abcdef123456"},
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertEqual(response.json()["status"], "ready")

    async def test_abort_upload_success(self):
        mock_db = AsyncMock()
        log_id = uuid.uuid4()
        existing_log = Log(
            id=log_id,
            file_name="test.zip",
            status="pending_upload",
            drive_folder="2026_11",
            file_size=1024,
            created_by=self.user_id,
        )

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = existing_log
        mock_db.execute.return_value = mock_result

        app.dependency_overrides[get_db] = lambda: mock_db

        with patch.object(settings, "medium_api_key", self.medium_key):
            response = self.client.post(
                f"/api/v1/logs/{log_id}/abort",
                headers={"Authorization": f"Bearer {self.medium_key}"},
                json={"reason": "Transfer interrupted"},
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertEqual(response.json()["status"], "aborted")

    async def test_download_log_success(self):
        mock_db = AsyncMock()
        log_id = uuid.uuid4()
        existing_log = Log(
            id=log_id,
            file_name="test.zip",
            status="ready",
            drive_folder="2026_11",
            drive_url="https://drive.google.com/file/d/test1234/view",
            file_size=1024,
            created_by=self.user_id,
        )

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = existing_log
        mock_db.execute.return_value = mock_result

        app.dependency_overrides[get_db] = lambda: mock_db

        with patch.object(settings, "medium_api_key", self.medium_key):
            # Test via ?token= query param
            response = self.client.get(
                f"/api/v1/logs/{log_id}/download?token={self.medium_key}",
                follow_redirects=False,
            )
            self.assertEqual(response.status_code, status.HTTP_307_TEMPORARY_REDIRECT)
            self.assertEqual(
                response.headers["location"],
                "https://drive.google.com/file/d/test1234/view",
            )

    async def test_patch_log_forbidden(self):
        mock_db = AsyncMock()
        log_id = uuid.uuid4()

        app.dependency_overrides[get_db] = lambda: mock_db

        with patch.object(settings, "medium_api_key", self.medium_key):
            response = self.client.patch(
                f"/api/v1/logs/{log_id}",
                headers={"Authorization": f"Bearer {self.medium_key}"},
                json={"note": "New note"},
            )
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
            self.assertIn("not permitted to modify", response.json()["detail"].lower())

    async def test_delete_log_forbidden(self):
        mock_db = AsyncMock()
        log_id = uuid.uuid4()

        app.dependency_overrides[get_db] = lambda: mock_db

        with patch.object(settings, "medium_api_key", self.medium_key):
            response = self.client.delete(
                f"/api/v1/logs/{log_id}",
                headers={"Authorization": f"Bearer {self.medium_key}"},
            )
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
            self.assertIn("not permitted to delete", response.json()["detail"].lower())

    async def test_cleanup_logs_forbidden(self):
        mock_db = AsyncMock()
        app.dependency_overrides[get_db] = lambda: mock_db

        with patch.object(settings, "medium_api_key", self.medium_key):
            response = self.client.post(
                "/api/v1/logs/cleanup",
                headers={"Authorization": f"Bearer {self.medium_key}"},
            )
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    async def test_user_endpoints_forbidden(self):
        mock_db = AsyncMock()
        app.dependency_overrides[get_db] = lambda: mock_db

        with patch.object(settings, "medium_api_key", self.medium_key):
            # GET /users
            r1 = self.client.get(
                "/api/v1/users",
                headers={"Authorization": f"Bearer {self.medium_key}"},
            )
            self.assertEqual(r1.status_code, status.HTTP_403_FORBIDDEN)

            # GET /users/me
            r2 = self.client.get(
                "/api/v1/users/me",
                headers={"Authorization": f"Bearer {self.medium_key}"},
            )
            self.assertEqual(r2.status_code, status.HTTP_403_FORBIDDEN)

            # GET /users/{id}
            r3 = self.client.get(
                f"/api/v1/users/{uuid.uuid4()}",
                headers={"Authorization": f"Bearer {self.medium_key}"},
            )
            self.assertEqual(r3.status_code, status.HTTP_403_FORBIDDEN)
