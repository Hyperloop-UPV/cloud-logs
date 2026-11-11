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
        self.assertIn("User cancelled in GUI", pending_log.note or "")
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

    def test_download_log_with_query_param_token(self):
        log_id = uuid.uuid4()
        ready_log = self._create_sample_log(log_id=log_id, status="ready")
        self.mock_result.scalar_one_or_none.return_value = ready_log

        response = self.client.get(
            f"/api/v1/logs/{log_id}/download?token={self.token}",
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 307)
        self.assertEqual(response.headers["location"], ready_log.drive_url)

    def test_simulated_upload_endpoint(self):
        log_id = uuid.uuid4()
        response = self.client.put(
            f"/api/v1/logs/simulated-upload/{log_id}",
            content=b"dummy binary data",
        )
        self.assertEqual(response.status_code, 200)

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

    def test_log_out_duration_computation(self):
        """LogOut computed field duration."""
        sample_log = self._create_sample_log()
        sample_log.start_date = datetime(2026, 10, 23, 10, 0, 0, tzinfo=UTC)
        sample_log.end_date = datetime(2026, 10, 23, 10, 5, 30, tzinfo=UTC)

        self.mock_result.scalar_one_or_none.return_value = sample_log
        res = self.client.get(f"/api/v1/logs/{sample_log.id}", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["duration"], 330.0)
        self.assertNotIn("durationSeconds", data)

    def test_get_tags_stats_endpoint(self):
        """GET /api/v1/logs/tags/stats returns rich tag breakdown."""
        sample_log = self._create_sample_log(tags=["pod", "bms"])
        sample_log.file_size = 5000
        self.mock_result.scalars.return_value.all.return_value = [sample_log]

        res = self.client.get("/api/v1/logs/tags/stats", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["totalTags"], 2)
        self.assertEqual(data["totalSize"], 10000)
        self.assertEqual(len(data["tags"]), 2)
        tag_names = {t["tag"] for t in data["tags"]}
        self.assertIn("pod", tag_names)
        self.assertIn("bms", tag_names)

    def test_list_tags_detailed(self):
        """GET /api/v1/logs/tags?detailed=true returns TagsStatsResponse."""
        sample_log = self._create_sample_log(tags=["pod"])
        self.mock_result.scalars.return_value.all.return_value = [sample_log]

        res = self.client.get("/api/v1/logs/tags?detailed=true", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("totalTags", data)
        self.assertIn("tags", data)

    def test_search_logs_metadata_query_allowed_for_regular_user(self):
        """Searching by client_metadata is allowed for all authenticated users."""
        self.mock_result.scalar.return_value = 0
        self.mock_result.scalars.return_value.all.return_value = []

        res = self.client.get("/api/v1/logs?metadataQuery=test_run", headers=self.headers)
        self.assertEqual(res.status_code, 200)

    def test_duration_with_mixed_naive_aware_timezones(self):
        """Verify duration calculation does not raise TypeError when mixing naive and aware datetimes."""
        sample_log = self._create_sample_log(status="ready")
        # start_date is naive, end_date is aware
        sample_log.start_date = datetime(2026, 10, 23, 10, 0, 0)
        sample_log.end_date = datetime(2026, 10, 23, 10, 2, 0, tzinfo=UTC)

        self.mock_result.scalar_one_or_none.return_value = sample_log
        res = self.client.get(f"/api/v1/logs/{sample_log.id}", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["duration"], 120.0)
        self.assertEqual(sample_log.duration, 120.0)

    def test_search_logs_empty_results(self):
        """Search query returning 0 results returns empty list and total 0."""
        self.mock_result.scalar.return_value = 0
        self.mock_result.scalars.return_value.all.return_value = []

        response = self.client.get(
            "/api/v1/logs?tags=nonexistent_tag_xyz",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["total"], 0)
        self.assertEqual(data["items"], [])
        self.assertEqual(data["page"], 1)
        self.assertEqual(data["pageSize"], 50)

    def test_search_logs_pagination_validation_errors(self):
        """FastAPI query validation rejects negative/zero pages and invalid page sizes."""
        # page < 1
        res1 = self.client.get("/api/v1/logs?page=0", headers=self.headers)
        self.assertEqual(res1.status_code, 422)

        res2 = self.client.get("/api/v1/logs?page=-5", headers=self.headers)
        self.assertEqual(res2.status_code, 422)

        # pageSize < 1
        res3 = self.client.get("/api/v1/logs?pageSize=0", headers=self.headers)
        self.assertEqual(res3.status_code, 422)

        res4 = self.client.get("/api/v1/logs?pageSize=-10", headers=self.headers)
        self.assertEqual(res4.status_code, 422)

        # pageSize > 100
        res5 = self.client.get("/api/v1/logs?pageSize=101", headers=self.headers)
        self.assertEqual(res5.status_code, 422)

    def test_idor_modify_or_delete_log_with_none_created_by_forbidden_for_regular_user(self):
        """When log has created_by=None, regular users cannot patch, delete, abort, or complete."""
        target_log = self._create_sample_log(status="pending_upload")
        target_log.created_by = None
        self.mock_result.scalar_one_or_none.return_value = target_log

        # PATCH
        patch_res = self.client.patch(
            f"/api/v1/logs/{target_log.id}",
            json={"note": "unauthorized"},
            headers=self.headers,
        )
        self.assertEqual(patch_res.status_code, 403)

        # DELETE
        delete_res = self.client.delete(
            f"/api/v1/logs/{target_log.id}",
            headers=self.headers,
        )
        self.assertEqual(delete_res.status_code, 403)

        # ABORT
        abort_res = self.client.post(
            f"/api/v1/logs/{target_log.id}/abort",
            json={"reason": "unauthorized"},
            headers=self.headers,
        )
        self.assertEqual(abort_res.status_code, 403)

        # COMPLETE
        complete_res = self.client.post(
            f"/api/v1/logs/{target_log.id}/complete",
            json={},
            headers=self.headers,
        )
        self.assertEqual(complete_res.status_code, 403)

    def test_idor_modify_log_with_none_created_by_allowed_for_admin_and_master(self):
        """Admin or Master Key can modify or delete a log even if created_by is None."""
        target_log = self._create_sample_log(status="ready")
        target_log.created_by = None
        self.mock_result.scalar_one_or_none.return_value = target_log

        # 1. Admin PATCH
        admin_user = User(id=uuid.uuid4(), username="admin_usr", role="admin")
        app.dependency_overrides[get_current_auth] = lambda: AuthContext(user=admin_user)
        patch_res = self.client.patch(
            f"/api/v1/logs/{target_log.id}",
            json={"note": "admin update"},
            headers=self.headers,
        )
        self.assertEqual(patch_res.status_code, 200)

        # 2. Master Key DELETE
        app.dependency_overrides[get_current_auth] = lambda: AuthContext(is_master=True)
        delete_res = self.client.delete(
            f"/api/v1/logs/{target_log.id}",
            headers=self.headers,
        )
        self.assertEqual(delete_res.status_code, 204)

    def test_check_log_modification_permission_function_directly(self):
        from fastapi import HTTPException

        from app.api.v1.logs import check_log_modification_permission

        owner_id = uuid.uuid4()
        other_id = uuid.uuid4()
        log = self._create_sample_log()
        log.created_by = owner_id

        # None user and not master -> 403
        with self.assertRaises(HTTPException) as cm:
            check_log_modification_permission(log, AuthContext(user=None, is_master=False))
        self.assertEqual(cm.exception.status_code, 403)

        # Different user -> 403
        other_user = User(id=other_id, username="other", role="user")
        with self.assertRaises(HTTPException) as cm:
            check_log_modification_permission(log, AuthContext(user=other_user))
        self.assertEqual(cm.exception.status_code, 403)

        # Same user -> allowed
        owner_user = User(id=owner_id, username="owner", role="user")
        self.assertIsNone(check_log_modification_permission(log, AuthContext(user=owner_user)))

        # Admin user -> allowed
        admin_user = User(id=other_id, username="admin", role="admin")
        self.assertIsNone(check_log_modification_permission(log, AuthContext(user=admin_user)))

        # Master key -> allowed
        self.assertIsNone(check_log_modification_permission(log, AuthContext(is_master=True)))

    def test_complete_upload_sets_file_size(self):
        """complete_log_upload applies file_size from verification payload when present."""
        log_id = uuid.uuid4()
        pending_log = self._create_sample_log(log_id=log_id, status="pending_upload")
        pending_log.file_size = None
        self.mock_result.scalar_one_or_none.return_value = pending_log

        mock_gdrive = MagicMock()
        mock_gdrive.verify_uploaded_file = AsyncMock(
            return_value={
                "verified": True,
                "drive_file_id": "verified_file_id",
                "drive_url": "https://drive.google.com/file/d/verified_file_id/view",
                "file_size": 16384,
            }
        )
        app.dependency_overrides[get_gdrive_service] = lambda: mock_gdrive

        response = self.client.post(
            f"/api/v1/logs/{log_id}/complete",
            json={"fileHash": "abcdef"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(pending_log.file_size, 16384)

    def test_get_tags_stats_with_fallback_dates(self):
        """compute_monthly_upload_stats falls back to file_date/created_at if drive_folder is invalid or missing."""
        from app.api.v1.logs import compute_monthly_upload_stats

        log1 = self._create_sample_log(tags=["propulsion"])
        log1.drive_folder = "corrupted_folder_format"
        log1.file_date = datetime(2026, 8, 10, 14, 0, 0, tzinfo=UTC)

        log2 = self._create_sample_log(tags=["telemetry"])
        log2.drive_folder = None
        log2.file_date = None
        log2.created_at = datetime(2026, 9, 20, 10, 0, 0, tzinfo=UTC)

        # Log with no dates at all should be skipped
        log3 = self._create_sample_log(tags=["orphan"])
        log3.drive_folder = None
        log3.file_date = None
        log3.created_at = None

        stats = compute_monthly_upload_stats([log1, log2, log3])
        folders = [s.folder for s in stats]
        self.assertIn("2026_08", folders)
        self.assertIn("2026_09", folders)
        self.assertEqual(len(stats), 2)

    def test_download_log_missing_drive_url(self):
        """download_log_file raises 404 if log is ready but has no drive_url."""
        log_id = uuid.uuid4()
        ready_log = self._create_sample_log(log_id=log_id, status="ready")
        ready_log.drive_url = None
        self.mock_result.scalar_one_or_none.return_value = ready_log

        response = self.client.get(
            f"/api/v1/logs/{log_id}/download",
            headers=self.headers,
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 404)
        self.assertIn("Google Drive URL is not available", response.json()["detail"])

