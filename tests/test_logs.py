"""Unit tests for Logs API endpoints and business logic."""

import uuid
from datetime import UTC, datetime
from unittest import TestCase
from unittest.mock import AsyncMock, MagicMock

from starlette.testclient import TestClient

from app.core.gdrive import GoogleDriveService, get_gdrive_service
from app.core.security import create_access_token
from app.db.session import get_db
from app.dependencies import AuthContext, get_current_auth
from app.main import app
from app.models.log import Log
from app.models.user import User


class TestLogsAPI(TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.user_id = uuid.uuid4()
        self.user = User(
            id=self.user_id,
            username="engineer_user",
            permissions=["engineer"],
        )
        self.token = create_access_token(
            {"sub": str(self.user_id), "permissions": ["engineer"]}
        )
        self.headers = {"Authorization": f"Bearer {self.token}"}

        # Mock DB session
        self.mock_db = AsyncMock()
        self.mock_db.add = MagicMock()
        self.mock_result = MagicMock()
        self.mock_db.execute.return_value = self.mock_result

        async def override_get_db():
            yield self.mock_db

        async def override_get_current_auth():
            return AuthContext(user=self.user)

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_auth] = override_get_current_auth
        app.dependency_overrides[get_gdrive_service] = lambda: GoogleDriveService(simulation_mode=True)

    def tearDown(self):
        app.dependency_overrides.clear()

    def _create_sample_log(
        self,
        log_id: uuid.UUID | None = None,
        status: str = "pending_upload",
        file_name: str = "telemetry_run.zip",
        tags: list[str] | None = None,
    ) -> Log:
        now = datetime.now(UTC)
        log = Log(
            id=log_id or uuid.uuid4(),
            file_name=file_name,
            status=status,
            drive_folder=now.strftime("%Y_%m"),
            drive_file_id="gdrive_file_123",
            drive_url="https://drive.google.com/file/d/gdrive_file_123/view",
            file_size=1048576,
            file_hash="abcdef123456",
            tags=tags if tags is not None else ["pod", "test"],
            note="Sample test log note",
            client_metadata={"run": 1},
            created_by=self.user_id,
            created_at=now,
        )
        log.creator_user = self.user
        return log

    def test_initiate_upload(self):
        payload = {
            "fileName": "track_run_01.zip",
            "fileSize": 2097152,
            "fileDate": "2026-10-23T12:00:00Z",
            "tags": ["propulsion", "track"],
            "note": "First run in October",
            "clientMetadata": {"podVersion": "V3"},
        }
        response = self.client.post(
            "/api/v1/logs/initiate",
            json=payload,
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertIn("id", data)
        self.assertIn("uploadUrl", data)
        self.assertEqual(data["driveFolder"], "2026_10")
        self.assertEqual(data["status"], "pending_upload")
        self.assertEqual(data["expiresInSeconds"], 86400)

        # Check that db.add and commit were executed
        self.mock_db.add.assert_called_once()
        self.mock_db.commit.assert_called_once()
        added_log = self.mock_db.add.call_args[0][0]
        self.assertEqual(added_log.file_name, "track_run_01.zip")
        self.assertEqual(added_log.drive_folder, "2026_10")
        self.assertEqual(added_log.created_by, self.user_id)
        self.assertIsNotNone(added_log.file_date)

    def test_complete_upload_success(self):
        log_id = uuid.uuid4()
        pending_log = self._create_sample_log(log_id=log_id, status="pending_upload")
        self.mock_result.scalar_one_or_none.return_value = pending_log

        response = self.client.post(
            f"/api/v1/logs/{log_id}/complete",
            json={"fileHash": "final_hash_789"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data["id"], str(log_id))
        self.assertEqual(data["status"], "ready")
        self.assertIn("driveUrl", data)
        self.assertEqual(pending_log.file_hash, "final_hash_789")
        self.mock_db.commit.assert_called_once()

    def test_complete_upload_idempotent_when_already_ready(self):
        log_id = uuid.uuid4()
        ready_log = self._create_sample_log(log_id=log_id, status="ready")
        self.mock_result.scalar_one_or_none.return_value = ready_log

        response = self.client.post(
            f"/api/v1/logs/{log_id}/complete",
            json={},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data["id"], str(log_id))
        self.assertEqual(data["status"], "ready")
        self.assertIn("already verified", data["message"])

    def test_complete_upload_not_found(self):
        log_id = uuid.uuid4()
        self.mock_result.scalar_one_or_none.return_value = None

        response = self.client.post(
            f"/api/v1/logs/{log_id}/complete",
            json={},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 404)

    def test_complete_upload_verification_failure(self):
        log_id = uuid.uuid4()
        pending_log = self._create_sample_log(log_id=log_id, status="pending_upload")
        self.mock_result.scalar_one_or_none.return_value = pending_log

        mock_gdrive = MagicMock(spec=GoogleDriveService)
        mock_gdrive.verify_uploaded_file = AsyncMock(return_value={"verified": False})
        app.dependency_overrides[get_gdrive_service] = lambda: mock_gdrive

        try:
            response = self.client.post(
                f"/api/v1/logs/{log_id}/complete",
                json={},
                headers=self.headers,
            )
            self.assertEqual(response.status_code, 400)
            self.assertIn("Upload verification failed", response.json()["detail"])
            self.assertEqual(pending_log.status, "failed")
        finally:
            app.dependency_overrides.pop(get_gdrive_service, None)

    def test_search_logs(self):
        sample_log = self._create_sample_log(status="ready")
        self.mock_result.scalar.return_value = 1
        self.mock_result.scalars.return_value.all.return_value = [sample_log]

        response = self.client.get(
            "/api/v1/logs?page=1&pageSize=20&tags=pod,test&status=ready&textQuery=telemetry",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data["total"], 1)
        self.assertEqual(data["page"], 1)
        self.assertEqual(data["pageSize"], 20)
        self.assertEqual(len(data["items"]), 1)
        self.assertEqual(data["items"][0]["id"], str(sample_log.id))
        self.assertEqual(data["items"][0]["creator"], "engineer_user")

    def test_search_logs_with_creator_and_dates(self):
        sample_log = self._create_sample_log(status="ready")
        self.mock_result.scalar.return_value = 1
        self.mock_result.scalars.return_value.all.return_value = [sample_log]

        response = self.client.get(
            "/api/v1/logs?creator=engineer_user&startDate=2026-10-01T00:00:00Z&endDate=2026-10-31T23:59:59Z",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["total"], 1)

    def test_list_tags(self):
        self.mock_result.scalars.return_value.all.return_value = [
            ["pod", "telemetria"],
            ["bms", "pod"],
            ["frenos"],
        ]
        response = self.client.get(
            "/api/v1/logs/tags",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        tags = response.json()

        self.assertIsInstance(tags, list)
        self.assertEqual(tags, ["bms", "frenos", "pod", "telemetria"])

    def test_get_log_detail_success(self):
        log_id = uuid.uuid4()
        sample_log = self._create_sample_log(log_id=log_id, status="ready")
        self.mock_result.scalar_one_or_none.return_value = sample_log

        response = self.client.get(
            f"/api/v1/logs/{log_id}",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data["id"], str(log_id))
        self.assertEqual(data["fileName"], sample_log.file_name)
        self.assertEqual(data["status"], "ready")
        self.assertEqual(data["creator"], "engineer_user")
        self.assertIn("driveUrl", data)

    def test_get_log_detail_not_found(self):
        log_id = uuid.uuid4()
        self.mock_result.scalar_one_or_none.return_value = None

        response = self.client.get(
            f"/api/v1/logs/{log_id}",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 404)

    def test_update_log_success(self):
        log_id = uuid.uuid4()
        sample_log = self._create_sample_log(log_id=log_id, status="ready")
        self.mock_result.scalar_one_or_none.return_value = sample_log

        update_payload = {
            "tags": ["pod", "updated_tag"],
            "note": "Updated note after engineer review",
            "clientMetadata": {"run": 2, "verified": True},
        }
        response = self.client.patch(
            f"/api/v1/logs/{log_id}",
            json=update_payload,
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data["id"], str(log_id))
        self.assertEqual(data["note"], "Updated note after engineer review")
        self.assertEqual(data["tags"], ["pod", "updated_tag"])
        self.assertEqual(data["clientMetadata"]["run"], 2)
        self.mock_db.commit.assert_called_once()

    def test_update_log_not_found(self):
        log_id = uuid.uuid4()
        self.mock_result.scalar_one_or_none.return_value = None

        response = self.client.patch(
            f"/api/v1/logs/{log_id}",
            json={"note": "New note"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 404)

    def test_delete_log_success(self):
        log_id = uuid.uuid4()
        sample_log = self._create_sample_log(log_id=log_id, status="ready")
        self.mock_result.scalar_one_or_none.return_value = sample_log

        response = self.client.delete(
            f"/api/v1/logs/{log_id}",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 204)
        self.assertIsNotNone(sample_log.deleted_at)
        self.mock_db.commit.assert_called_once()

    def test_delete_log_not_found(self):
        log_id = uuid.uuid4()
        self.mock_result.scalar_one_or_none.return_value = None

        response = self.client.delete(
            f"/api/v1/logs/{log_id}",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 404)

    def test_abort_upload_success(self):
        log_id = uuid.uuid4()
        pending_log = self._create_sample_log(log_id=log_id, status="pending_upload")
        self.mock_result.scalar_one_or_none.return_value = pending_log

        response = self.client.post(
            f"/api/v1/logs/{log_id}/abort",
            json={"reason": "User cancelled in GUI"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["id"], str(log_id))
        self.assertEqual(data["status"], "aborted")
        self.assertEqual(pending_log.status, "aborted")
        self.assertIn("User cancelled in GUI", pending_log.note)
        self.mock_db.commit.assert_called_once()

    def test_abort_upload_already_ready_fails(self):
        log_id = uuid.uuid4()
        ready_log = self._create_sample_log(log_id=log_id, status="ready")
        self.mock_result.scalar_one_or_none.return_value = ready_log

        response = self.client.post(
            f"/api/v1/logs/{log_id}/abort",
            json={"reason": "Too late"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Cannot abort", response.json()["detail"])

    def test_abort_upload_idempotent(self):
        log_id = uuid.uuid4()
        aborted_log = self._create_sample_log(log_id=log_id, status="aborted")
        self.mock_result.scalar_one_or_none.return_value = aborted_log

        response = self.client.post(
            f"/api/v1/logs/{log_id}/abort",
            json={},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "aborted")
        self.assertIn("already aborted", data["message"])

    def test_abort_upload_not_found(self):
        log_id = uuid.uuid4()
        self.mock_result.scalar_one_or_none.return_value = None

        response = self.client.post(
            f"/api/v1/logs/{log_id}/abort",
            json={},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 404)

    def test_download_log_success(self):
        log_id = uuid.uuid4()
        ready_log = self._create_sample_log(log_id=log_id, status="ready")
        self.mock_result.scalar_one_or_none.return_value = ready_log

        response = self.client.get(
            f"/api/v1/logs/{log_id}/download",
            headers=self.headers,
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 307)
        self.assertEqual(response.headers["location"], ready_log.drive_url)

    def test_download_log_not_ready_fails(self):
        log_id = uuid.uuid4()
        pending_log = self._create_sample_log(log_id=log_id, status="pending_upload")
        self.mock_result.scalar_one_or_none.return_value = pending_log

        response = self.client.get(
            f"/api/v1/logs/{log_id}/download",
            headers=self.headers,
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("not ready for download", response.json()["detail"])

    def test_download_log_not_found(self):
        log_id = uuid.uuid4()
        self.mock_result.scalar_one_or_none.return_value = None

        response = self.client.get(
            f"/api/v1/logs/{log_id}/download",
            headers=self.headers,
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 404)

    def test_search_logs_with_sorting(self):
        sample_log = self._create_sample_log(status="ready")
        self.mock_result.scalar.return_value = 1
        self.mock_result.scalars.return_value.all.return_value = [sample_log]

        response = self.client.get(
            "/api/v1/logs?sortBy=fileSize&sortOrder=asc",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)

    def test_search_logs_invalid_sort_by(self):
        response = self.client.get(
            "/api/v1/logs?sortBy=nonexistent_column",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid sortBy", response.json()["detail"])

    def test_search_logs_invalid_sort_order(self):
        response = self.client.get(
            "/api/v1/logs?sortOrder=sideways",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid sortOrder", response.json()["detail"])

    def test_cleanup_forbidden_for_engineer(self):
        # self.headers has engineer permissions, cleanup requires admin
        response = self.client.post(
            "/api/v1/logs/cleanup",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 403)
        self.assertIn("admin", response.json()["detail"])

    def test_cleanup_allowed_for_admin(self):
        admin_user = User(
            id=uuid.uuid4(),
            username="admin_user",
            permissions=["admin"],
        )
        async def override_get_current_auth_admin():
            return AuthContext(user=admin_user)

        app.dependency_overrides[get_current_auth] = override_get_current_auth_admin
        # Mock empty results for cleanup queries
        self.mock_result.scalars.return_value.all.return_value = []

        response = self.client.post(
            "/api/v1/logs/cleanup?retentionDays=30&dryRun=true",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["affectedLogs"], 0)
        self.assertEqual(data["orphanedCleaned"], 0)
        self.assertEqual(data["tokensCleaned"], 0)
        self.assertTrue(data["dryRun"])
        self.assertIn("Dry run complete", data["message"])

    def test_idor_forbidden_for_different_regular_user(self):
        """A regular user different from the log's creator cannot patch, delete, abort, or complete."""
        target_log = self._create_sample_log(status="pending_upload")
        self.mock_result.scalar_one_or_none.return_value = target_log

        # Authenticated as a different regular user
        other_user = User(
            id=uuid.uuid4(),
            username="other_engineer",
            role="user",
        )
        app.dependency_overrides[get_current_auth] = lambda: AuthContext(user=other_user)

        # 1. PATCH
        patch_res = self.client.patch(
            f"/api/v1/logs/{target_log.id}",
            json={"note": "attempted unauthorized update"},
            headers=self.headers,
        )
        self.assertEqual(patch_res.status_code, 403)
        self.assertIn("You do not have permission to modify or delete this log", patch_res.json()["detail"])

        # 2. DELETE
        delete_res = self.client.delete(
            f"/api/v1/logs/{target_log.id}",
            headers=self.headers,
        )
        self.assertEqual(delete_res.status_code, 403)
        self.assertIn("You do not have permission to modify or delete this log", delete_res.json()["detail"])

        # 3. ABORT
        abort_res = self.client.post(
            f"/api/v1/logs/{target_log.id}/abort",
            json={"reason": "unauthorized abort"},
            headers=self.headers,
        )
        self.assertEqual(abort_res.status_code, 403)
        self.assertIn("You do not have permission to modify or delete this log", abort_res.json()["detail"])

        # 4. COMPLETE
        complete_res = self.client.post(
            f"/api/v1/logs/{target_log.id}/complete",
            json={},
            headers=self.headers,
        )
        self.assertEqual(complete_res.status_code, 403)
        self.assertIn("You do not have permission to modify or delete this log", complete_res.json()["detail"])

    def test_idor_allowed_for_original_creator(self):
        """The original creator can patch, abort, complete, and delete their own log."""
        # 1. Creator can PATCH
        log_to_patch = self._create_sample_log(status="ready")
        self.mock_result.scalar_one_or_none.return_value = log_to_patch
        patch_res = self.client.patch(
            f"/api/v1/logs/{log_to_patch.id}",
            json={"note": "creator update"},
            headers=self.headers,
        )
        self.assertEqual(patch_res.status_code, 200)

        # 2. Creator can ABORT
        log_to_abort = self._create_sample_log(status="pending_upload")
        self.mock_result.scalar_one_or_none.return_value = log_to_abort
        abort_res = self.client.post(
            f"/api/v1/logs/{log_to_abort.id}/abort",
            json={"reason": "creator abort"},
            headers=self.headers,
        )
        self.assertEqual(abort_res.status_code, 200)

        # 3. Creator can COMPLETE
        log_to_complete = self._create_sample_log(status="pending_upload")
        self.mock_result.scalar_one_or_none.return_value = log_to_complete
        complete_res = self.client.post(
            f"/api/v1/logs/{log_to_complete.id}/complete",
            json={},
            headers=self.headers,
        )
        self.assertEqual(complete_res.status_code, 200)

        # 4. Creator can DELETE
        log_to_delete = self._create_sample_log(status="ready")
        self.mock_result.scalar_one_or_none.return_value = log_to_delete
        delete_res = self.client.delete(
            f"/api/v1/logs/{log_to_delete.id}",
            headers=self.headers,
        )
        self.assertEqual(delete_res.status_code, 204)

    def test_idor_allowed_for_admin_user(self):
        """An admin user can patch, abort, complete, and delete logs created by others."""
        admin_user = User(
            id=uuid.uuid4(),
            username="admin_reviewer",
            role="admin",
        )
        app.dependency_overrides[get_current_auth] = lambda: AuthContext(user=admin_user)

        # 1. Admin can PATCH log of another user
        log_to_patch = self._create_sample_log(status="ready")
        self.mock_result.scalar_one_or_none.return_value = log_to_patch
        patch_res = self.client.patch(
            f"/api/v1/logs/{log_to_patch.id}",
            json={"note": "admin update"},
            headers=self.headers,
        )
        self.assertEqual(patch_res.status_code, 200)

        # 2. Admin can ABORT log of another user
        log_to_abort = self._create_sample_log(status="pending_upload")
        self.mock_result.scalar_one_or_none.return_value = log_to_abort
        abort_res = self.client.post(
            f"/api/v1/logs/{log_to_abort.id}/abort",
            json={"reason": "admin cancellation"},
            headers=self.headers,
        )
        self.assertEqual(abort_res.status_code, 200)

        # 3. Admin can COMPLETE log of another user
        log_to_complete = self._create_sample_log(status="pending_upload")
        self.mock_result.scalar_one_or_none.return_value = log_to_complete
        complete_res = self.client.post(
            f"/api/v1/logs/{log_to_complete.id}/complete",
            json={},
            headers=self.headers,
        )
        self.assertEqual(complete_res.status_code, 200)

        # 4. Admin can DELETE log of another user
        log_to_delete = self._create_sample_log(status="ready")
        self.mock_result.scalar_one_or_none.return_value = log_to_delete
        delete_res = self.client.delete(
            f"/api/v1/logs/{log_to_delete.id}",
            headers=self.headers,
        )
        self.assertEqual(delete_res.status_code, 204)

    def test_idor_allowed_for_master_api_key(self):
        """Master API Key can patch, abort, complete, and delete logs created by any user."""
        app.dependency_overrides[get_current_auth] = lambda: AuthContext(is_master=True)

        # 1. Master Key can PATCH log of another user
        log_to_patch = self._create_sample_log(status="ready")
        self.mock_result.scalar_one_or_none.return_value = log_to_patch
        patch_res = self.client.patch(
            f"/api/v1/logs/{log_to_patch.id}",
            json={"note": "master key update"},
            headers=self.headers,
        )
        self.assertEqual(patch_res.status_code, 200)

        # 2. Master Key can ABORT log of another user
        log_to_abort = self._create_sample_log(status="pending_upload")
        self.mock_result.scalar_one_or_none.return_value = log_to_abort
        abort_res = self.client.post(
            f"/api/v1/logs/{log_to_abort.id}/abort",
            json={"reason": "master key cancellation"},
            headers=self.headers,
        )
        self.assertEqual(abort_res.status_code, 200)

        # 3. Master Key can COMPLETE log of another user
        log_to_complete = self._create_sample_log(status="pending_upload")
        self.mock_result.scalar_one_or_none.return_value = log_to_complete
        complete_res = self.client.post(
            f"/api/v1/logs/{log_to_complete.id}/complete",
            json={},
            headers=self.headers,
        )
        self.assertEqual(complete_res.status_code, 200)

        # 4. Master Key can DELETE log of another user
        log_to_delete = self._create_sample_log(status="ready")
        self.mock_result.scalar_one_or_none.return_value = log_to_delete
        delete_res = self.client.delete(
            f"/api/v1/logs/{log_to_delete.id}",
            headers=self.headers,
        )
        self.assertEqual(delete_res.status_code, 204)
