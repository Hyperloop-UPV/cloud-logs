"""Comprehensive integration tests running end-to-end against real SQLite in-memory."""

import asyncio
import hashlib
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from starlette.testclient import TestClient

from app.config import settings
from app.core.gdrive import GoogleDriveService, get_gdrive_service
from app.core.security import create_access_token, generate_random_token, hash_token
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.auth import RefreshToken
from app.models.log import Log
from app.models.user import User


class TestSQLiteIntegration(IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # Create an isolated in-memory SQLite database for each test
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        self.session_factory = async_sessionmaker(
            self.engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )

        self.engineer_id = uuid.uuid4()
        self.viewer_id = uuid.uuid4()
        self.admin_id = uuid.uuid4()

        async with self.session_factory() as session:
            self.engineer = User(
                id=self.engineer_id,
                username="eng_alice",
                permissions=["engineer"],
            )
            self.viewer = User(
                id=self.viewer_id,
                username="viewer_bob",
                permissions=["viewer"],
            )
            self.admin = User(
                id=self.admin_id,
                username="admin_charlie",
                permissions=["admin"],
            )
            session.add_all([self.engineer, self.viewer, self.admin])
            await session.commit()

        # Database dependency override
        async def override_get_db():
            async with self.session_factory() as session:
                try:
                    yield session
                    await session.commit()
                except Exception:
                    await session.rollback()
                    raise

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_gdrive_service] = lambda: GoogleDriveService(simulation_mode=True)

        self.client = TestClient(app)

        # Tokens
        self.eng_token = create_access_token(
            {"sub": str(self.engineer_id), "permissions": ["engineer"]}
        )
        self.viewer_token = create_access_token(
            {"sub": str(self.viewer_id), "permissions": ["viewer"]}
        )
        self.admin_token = create_access_token(
            {"sub": str(self.admin_id), "permissions": ["admin"]}
        )

        self.eng_headers = {"Authorization": f"Bearer {self.eng_token}"}
        self.viewer_headers = {"Authorization": f"Bearer {self.viewer_token}"}
        self.admin_headers = {"Authorization": f"Bearer {self.admin_token}"}

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        await self.engine.dispose()

    def test_full_log_lifecycle_sqlite(self):
        """End-to-end test of the complete two-phase upload and query workflow."""
        # 1. Initiate upload
        payload = {
            "fileName": "telemetry_run_01.zip",
            "fileSize": 1048576,
            "tags": ["bms", "sqlite_run"],
            "note": "Full lifecycle run",
            "clientMetadata": {"runNumber": 1},
        }
        res_init = self.client.post("/api/v1/logs/initiate", json=payload, headers=self.eng_headers)
        self.assertEqual(res_init.status_code, 200)
        data_init = res_init.json()
        log_id = data_init["id"]
        self.assertEqual(data_init["status"], "pending_upload")
        self.assertIn("driveFolder", data_init)
        self.assertIn("uploadUrl", data_init)

        # 2. Complete upload
        res_comp = self.client.post(
            f"/api/v1/logs/{log_id}/complete",
            json={"fileHash": "sha256_mock_hash"},
            headers=self.eng_headers,
        )
        self.assertEqual(res_comp.status_code, 200)
        data_comp = res_comp.json()
        self.assertEqual(data_comp["status"], "ready")
        self.assertIn("driveUrl", data_comp)
        self.assertEqual(data_comp["id"], log_id)

        # 3. Retrieve log detail
        res_get = self.client.get(f"/api/v1/logs/{log_id}", headers=self.eng_headers)
        self.assertEqual(res_get.status_code, 200)
        data_get = res_get.json()
        self.assertEqual(data_get["fileName"], "telemetry_run_01.zip")
        self.assertEqual(data_get["creator"], "eng_alice")
        self.assertEqual(data_get["fileHash"], "sha256_mock_hash")
        self.assertIn("sqlite_run", data_get["tags"])

        # 4. Search by tag and text
        res_search = self.client.get(
            "/api/v1/logs?tags=sqlite_run&textQuery=telemetry",
            headers=self.eng_headers,
        )
        self.assertEqual(res_search.status_code, 200)
        data_search = res_search.json()
        self.assertEqual(data_search["total"], 1)
        self.assertEqual(data_search["items"][0]["id"], log_id)

        # 5. List unique tags
        res_tags = self.client.get("/api/v1/logs/tags", headers=self.eng_headers)
        self.assertEqual(res_tags.status_code, 200)
        self.assertIn("bms", res_tags.json())
        self.assertIn("sqlite_run", res_tags.json())

        # 6. Update log metadata
        res_patch = self.client.patch(
            f"/api/v1/logs/{log_id}",
            json={"note": "Updated note", "tags": ["sqlite_run", "verified"]},
            headers=self.eng_headers,
        )
        self.assertEqual(res_patch.status_code, 200)
        self.assertEqual(res_patch.json()["note"], "Updated note")
        self.assertIn("verified", res_patch.json()["tags"])

        # 7. Soft delete log
        res_del = self.client.delete(f"/api/v1/logs/{log_id}", headers=self.eng_headers)
        self.assertEqual(res_del.status_code, 204)

        # 8. Subsequent GET returns 404
        res_deleted = self.client.get(f"/api/v1/logs/{log_id}", headers=self.eng_headers)
        self.assertEqual(res_deleted.status_code, 404)

    def test_rbac_permission_enforcement(self):
        """Test RBAC: Common users can upload, manage, and read logs, but admin actions are restricted."""
        # 1. Common user creates and completes a log
        init_res = self.client.post(
            "/api/v1/logs/initiate",
            json={"fileName": "common_user_run.zip", "fileSize": 100},
            headers=self.eng_headers,
        )
        self.assertEqual(init_res.status_code, 200)
        log_id = init_res.json()["id"]

        comp_res = self.client.post(
            f"/api/v1/logs/{log_id}/complete",
            json={},
            headers=self.eng_headers,
        )
        self.assertEqual(comp_res.status_code, 200)

        # 2. Common user CAN patch, read search, detail, tags, and stats
        patch_res = self.client.patch(
            f"/api/v1/logs/{log_id}",
            json={"note": "updated note"},
            headers=self.eng_headers,
        )
        self.assertEqual(patch_res.status_code, 200)
        self.assertEqual(self.client.get("/api/v1/logs", headers=self.eng_headers).status_code, 200)
        self.assertEqual(self.client.get(f"/api/v1/logs/{log_id}", headers=self.eng_headers).status_code, 200)
        self.assertEqual(self.client.get("/api/v1/logs/tags", headers=self.eng_headers).status_code, 200)
        self.assertEqual(self.client.get("/api/v1/logs/stats", headers=self.eng_headers).status_code, 200)

        # 3. Common user CANNOT perform admin actions (403 Forbidden)
        # 3a. Searching by client metadata
        res_meta = self.client.get("/api/v1/logs?metadataQuery=secret", headers=self.eng_headers)
        self.assertEqual(res_meta.status_code, 403)

        # 3b. Triggering cleanup
        res_clean = self.client.post("/api/v1/logs/cleanup", headers=self.eng_headers)
        self.assertEqual(res_clean.status_code, 403)

        # 3c. Listing all users
        res_users = self.client.get("/api/v1/users", headers=self.eng_headers)
        self.assertEqual(res_users.status_code, 403)

        # 3d. Modifying user roles
        res_role = self.client.patch(f"/api/v1/users/{self.admin_id}/role", json={"role": "user"}, headers=self.eng_headers)
        self.assertEqual(res_role.status_code, 403)

        # 4. Unauthenticated requests receive 401
        self.assertEqual(self.client.get("/api/v1/logs").status_code, 401)
        self.assertEqual(self.client.post("/api/v1/logs/initiate", json={}).status_code, 401)

    def test_abort_upload_workflow(self):
        """Test abort endpoint logic and state transitions."""
        # Initiate a log
        init_res = self.client.post(
            "/api/v1/logs/initiate",
            json={"fileName": "abort_test.zip", "fileSize": 500},
            headers=self.eng_headers,
        )
        log_id = init_res.json()["id"]

        # Abort the pending upload
        abort_res = self.client.post(
            f"/api/v1/logs/{log_id}/abort",
            json={"reason": "Hardware communication glitch"},
            headers=self.eng_headers,
        )
        self.assertEqual(abort_res.status_code, 200)
        data = abort_res.json()
        self.assertEqual(data["status"], "aborted")
        self.assertIn("aborted successfully", data["message"])

        # Check detail reflects aborted status and note
        detail_res = self.client.get(f"/api/v1/logs/{log_id}", headers=self.eng_headers)
        self.assertEqual(detail_res.json()["status"], "aborted")
        self.assertIn("Hardware communication glitch", detail_res.json()["note"])

        # Cannot complete an aborted upload
        comp_res = self.client.post(f"/api/v1/logs/{log_id}/complete", json={}, headers=self.eng_headers)
        self.assertEqual(comp_res.status_code, 400)
        self.assertIn("has been aborted", comp_res.json()["detail"])

        # Aborting again is idempotent
        repeat_abort = self.client.post(f"/api/v1/logs/{log_id}/abort", json={}, headers=self.eng_headers)
        self.assertEqual(repeat_abort.status_code, 200)
        self.assertEqual(repeat_abort.json()["status"], "aborted")

    def test_download_redirect_and_permissions(self):
        """Test download redirect to Google Drive URL and checks."""
        # Create and complete a log
        init_res = self.client.post(
            "/api/v1/logs/initiate",
            json={"fileName": "downloadable.zip", "fileSize": 1000},
            headers=self.eng_headers,
        )
        log_id = init_res.json()["id"]

        # Pending log cannot be downloaded
        down_pending = self.client.get(
            f"/api/v1/logs/{log_id}/download",
            headers=self.viewer_headers,
            follow_redirects=False,
        )
        self.assertEqual(down_pending.status_code, 400)
        self.assertIn("not ready for download", down_pending.json()["detail"])

        # Complete the upload
        comp_res = self.client.post(f"/api/v1/logs/{log_id}/complete", json={}, headers=self.eng_headers)
        drive_url = comp_res.json()["driveUrl"]

        # Viewer can download: receives 307 redirect
        down_ready = self.client.get(
            f"/api/v1/logs/{log_id}/download",
            headers=self.viewer_headers,
            follow_redirects=False,
        )
        self.assertEqual(down_ready.status_code, 307)
        self.assertEqual(down_ready.headers["location"], drive_url)

        # Unauthenticated receives 401
        self.assertEqual(self.client.get(f"/api/v1/logs/{log_id}/download").status_code, 401)

    def test_stats_aggregation(self):
        """Test stats endpoint metrics across multiple statuses and folders."""
        now = datetime.now(UTC)

        async def seed():
            async with self.session_factory() as session:
                l1 = Log(
                    id=uuid.uuid4(),
                    file_name="ready_01.zip",
                    status="ready",
                    drive_folder="2026_10",
                    file_size=2000,
                    tags=["pod", "bms"],
                    created_by=self.engineer_id,
                    created_at=now,
                )
                l2 = Log(
                    id=uuid.uuid4(),
                    file_name="ready_02.zip",
                    status="ready",
                    drive_folder="2026_10",
                    file_size=3000,
                    tags=["pod", "telemetria"],
                    created_by=self.engineer_id,
                    created_at=now,
                )
                l3 = Log(
                    id=uuid.uuid4(),
                    file_name="pending_01.zip",
                    status="pending_upload",
                    drive_folder="2026_09",
                    file_size=5000,
                    tags=["motor"],
                    created_by=self.engineer_id,
                    created_at=now,
                )
                l4 = Log(
                    id=uuid.uuid4(),
                    file_name="aborted_01.zip",
                    status="aborted",
                    drive_folder="2026_09",
                    file_size=1000,
                    tags=["frenos"],
                    created_by=self.engineer_id,
                    created_at=now,
                )
                session.add_all([l1, l2, l3, l4])
                await session.commit()

        import asyncio
        asyncio.run(seed())

        res = self.client.get("/api/v1/logs/stats", headers=self.viewer_headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertEqual(data["totalLogs"], 4)
        # Only ready logs count towards totalBytes: 2000 + 3000 = 5000
        self.assertEqual(data["totalBytes"], 5000)
        self.assertEqual(data["byStatus"]["ready"], 2)
        self.assertEqual(data["byStatus"]["pending_upload"], 1)
        self.assertEqual(data["byStatus"]["aborted"], 1)
        self.assertEqual(data["byFolder"]["2026_10"], 2)
        self.assertEqual(data["byFolder"]["2026_09"], 2)
        self.assertEqual(data["totalTags"], 5)
        # Top tag is "pod" with count 2
        self.assertEqual(data["topTags"][0]["tag"], "pod")
        self.assertEqual(data["topTags"][0]["count"], 2)

    def test_sorting_and_client_metadata_admin_search(self):
        """Test sortBy / sortOrder and client metadata admin-only filtering."""
        now = datetime.now(UTC)

        async def seed():
            async with self.session_factory() as session:
                l1 = Log(
                    id=uuid.uuid4(),
                    file_name="alpha.zip",
                    status="ready",
                    file_size=100,
                    client_metadata={"hostname": "pod-orin-01", "clientUser": "operator_pau", "runUuid": "run-abc"},
                    created_by=self.engineer_id,
                    created_at=now,
                )
                l2 = Log(
                    id=uuid.uuid4(),
                    file_name="beta.zip",
                    status="ready",
                    file_size=500,
                    client_metadata={"hostname": "bench-dyno-master", "clientUser": "test_engineer", "runUuid": "run-xyz"},
                    created_by=self.engineer_id,
                    created_at=now,
                )
                session.add_all([l1, l2])
                await session.commit()

        import asyncio
        asyncio.run(seed())

        # Test alphabetical sorting ascending
        res_asc = self.client.get("/api/v1/logs?sortBy=fileName&sortOrder=asc", headers=self.eng_headers)
        items_asc = res_asc.json()["items"]
        self.assertEqual(items_asc[0]["fileName"], "alpha.zip")
        self.assertEqual(items_asc[1]["fileName"], "beta.zip")

        # Test alphabetical sorting descending
        res_desc = self.client.get("/api/v1/logs?sortBy=fileName&sortOrder=desc", headers=self.eng_headers)
        items_desc = res_desc.json()["items"]
        self.assertEqual(items_desc[0]["fileName"], "beta.zip")
        self.assertEqual(items_desc[1]["fileName"], "alpha.zip")

        # Test size sorting
        res_size = self.client.get("/api/v1/logs?sortBy=fileSize&sortOrder=desc", headers=self.eng_headers)
        self.assertEqual(res_size.json()["items"][0]["fileSize"], 500)

        # Client metadata search by regular user (engineer/viewer) -> 403 Forbidden
        res_forbidden = self.client.get("/api/v1/logs?metadataQuery=pod-orin", headers=self.eng_headers)
        self.assertEqual(res_forbidden.status_code, 403)
        self.assertIn("restricted to administrators", res_forbidden.json()["detail"])

        # Client metadata search by admin -> 200 OK
        res_admin = self.client.get("/api/v1/logs?metadataQuery=pod-orin", headers=self.admin_headers)
        self.assertEqual(res_admin.status_code, 200)
        self.assertEqual(res_admin.json()["total"], 1)
        self.assertEqual(res_admin.json()["items"][0]["fileName"], "alpha.zip")

        # Client metadata search by runUuid
        res_uuid = self.client.get("/api/v1/logs?metadataQuery=run-xyz", headers=self.admin_headers)
        self.assertEqual(res_uuid.status_code, 200)
        self.assertEqual(res_uuid.json()["total"], 1)
        self.assertEqual(res_uuid.json()["items"][0]["fileName"], "beta.zip")

    def test_master_api_key_access(self):
        """Test that Master API Key can bypass JWT and perform administrative writes."""
        master_key = "hlp_secret_integration_master_key"
        master_hash = hashlib.sha256(master_key.encode("utf-8")).hexdigest()

        with patch.object(settings, "master_api_key_hash", master_hash):
            headers = {"X-API-Key": master_key}
            res = self.client.post(
                "/api/v1/logs/initiate",
                json={"fileName": "master_run.zip", "fileSize": 5000},
                headers=headers,
            )
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["status"], "pending_upload")

    def test_schema_validation_errors(self):
        """Test input validation rules and error response format."""
        # Empty filename
        r1 = self.client.post(
            "/api/v1/logs/initiate",
            json={"fileName": "", "fileSize": 100},
            headers=self.eng_headers,
        )
        self.assertEqual(r1.status_code, 422)

        # Negative file size
        r2 = self.client.post(
            "/api/v1/logs/initiate",
            json={"fileName": "run.zip", "fileSize": -10},
            headers=self.eng_headers,
        )
        self.assertEqual(r2.status_code, 422)

        # Invalid page size (exceeds max 100)
        r3 = self.client.get("/api/v1/logs?pageSize=150", headers=self.eng_headers)
        self.assertEqual(r3.status_code, 422)

        # Invalid page (less than 1)
        r4 = self.client.get("/api/v1/logs?page=0", headers=self.eng_headers)
        self.assertEqual(r4.status_code, 422)

        # Invalid UUID format
        r5 = self.client.get("/api/v1/logs/not-a-valid-uuid", headers=self.eng_headers)
        self.assertEqual(r5.status_code, 422)

    def test_advanced_filtering_and_pagination(self):
        """Test multi-tag matching, exact tag isolation, date ranges, and pagination."""
        now = datetime.now(UTC)

        # Seed 3 distinct logs directly into database
        async def seed():
            async with self.session_factory() as session:
                l1 = Log(
                    id=uuid.uuid4(),
                    file_name="battery_run.zip",
                    status="ready",
                    drive_folder="2026_10",
                    tags=["bms", "pod"],
                    note="High discharge battery test",
                    created_by=self.engineer_id,
                    created_at=now,
                )
                l2 = Log(
                    id=uuid.uuid4(),
                    file_name="motor_dyno.zip",
                    status="ready",
                    drive_folder="2026_10",
                    tags=["motor", "pod_v2"],
                    note="Inverter test at 10000 RPM",
                    created_by=self.engineer_id,
                    created_at=now,
                )
                l3 = Log(
                    id=uuid.uuid4(),
                    file_name="brakes_bench.zip",
                    status="pending_upload",
                    drive_folder="2026_09",
                    tags=["frenos"],
                    note="Pneumatic brake test",
                    created_by=self.engineer_id,
                    created_at=now,
                )
                session.add_all([l1, l2, l3])
                await session.commit()

        import asyncio
        asyncio.run(seed())

        # Exact tag isolation: searching for 'pod' should NOT match 'pod_v2'
        res_pod = self.client.get("/api/v1/logs?tags=pod", headers=self.eng_headers)
        self.assertEqual(res_pod.status_code, 200)
        data_pod = res_pod.json()
        self.assertEqual(data_pod["total"], 1)
        self.assertEqual(data_pod["items"][0]["fileName"], "battery_run.zip")

        # Status filter
        res_pending = self.client.get("/api/v1/logs?status=pending_upload", headers=self.eng_headers)
        self.assertEqual(res_pending.status_code, 200)
        self.assertEqual(res_pending.json()["total"], 1)
        self.assertEqual(res_pending.json()["items"][0]["fileName"], "brakes_bench.zip")

        # Folder filter
        res_folder = self.client.get("/api/v1/logs?driveFolder=2026_09", headers=self.eng_headers)
        self.assertEqual(res_folder.status_code, 200)
        self.assertEqual(res_folder.json()["total"], 1)

        # Pagination test: pageSize=2 on 3 items
        res_p1 = self.client.get("/api/v1/logs?page=1&pageSize=2", headers=self.eng_headers)
        self.assertEqual(res_p1.status_code, 200)
        self.assertEqual(len(res_p1.json()["items"]), 2)
        self.assertEqual(res_p1.json()["total"], 3)

        res_p2 = self.client.get("/api/v1/logs?page=2&pageSize=2", headers=self.eng_headers)
        self.assertEqual(res_p2.status_code, 200)
        self.assertEqual(len(res_p2.json()["items"]), 1)

    def test_soft_delete_isolation(self):
        """Verify that soft-deleted logs are excluded from search, tags, and detail."""
        res_init = self.client.post(
            "/api/v1/logs/initiate",
            json={"fileName": "to_be_deleted.zip", "fileSize": 100, "tags": ["ephemeral_tag"]},
            headers=self.eng_headers,
        )
        log_id = res_init.json()["id"]

        # Tag appears in list_tags
        tags_before = self.client.get("/api/v1/logs/tags", headers=self.eng_headers).json()
        self.assertIn("ephemeral_tag", tags_before)

        # Delete log
        del_res = self.client.delete(f"/api/v1/logs/{log_id}", headers=self.eng_headers)
        self.assertEqual(del_res.status_code, 204)

        # Tag no longer appears in list_tags
        tags_after = self.client.get("/api/v1/logs/tags", headers=self.eng_headers).json()
        self.assertNotIn("ephemeral_tag", tags_after)

        # Detail returns 404
        self.assertEqual(self.client.get(f"/api/v1/logs/{log_id}", headers=self.eng_headers).status_code, 404)

        # Updating deleted returns 404
        self.assertEqual(
            self.client.patch(f"/api/v1/logs/{log_id}", json={"note": "new"}, headers=self.eng_headers).status_code,
            404,
        )

        # Deleting again returns 404
        self.assertEqual(self.client.delete(f"/api/v1/logs/{log_id}", headers=self.eng_headers).status_code, 404)

    async def test_cleanup_workflow_and_retention_policy(self):
        """Verify that weekly cleanup removes only stale uncompleted uploads (> 30 days),
        never touches completed logs (ready), respects dryRun, and supports purging soft-deleted records."""
        now = datetime.now(UTC)
        t_old_35 = now - timedelta(days=35)
        t_old_40 = now - timedelta(days=40)
        t_old_32 = now - timedelta(days=32)
        t_old_45 = now - timedelta(days=45)
        t_old_60 = now - timedelta(days=60)
        t_recent = now - timedelta(days=2)

        id_old_pending = uuid.uuid4()
        id_old_aborted = uuid.uuid4()
        id_old_failed = uuid.uuid4()
        id_old_ready = uuid.uuid4()
        id_recent_pending = uuid.uuid4()
        id_recent_ready = uuid.uuid4()
        id_stale_deleted = uuid.uuid4()

        async with self.session_factory() as session:
            # 1. Stale uncompleted logs (> 30 days old)
            log_old_pending = Log(
                id=id_old_pending,
                file_name="abandoned_upload.zip",
                file_size=1024,
                status="pending_upload",
                created_at=t_old_35,
                created_by=self.engineer_id,
            )
            log_old_aborted = Log(
                id=id_old_aborted,
                file_name="aborted_upload.zip",
                file_size=2048,
                status="aborted",
                created_at=t_old_40,
                created_by=self.engineer_id,
            )
            log_old_failed = Log(
                id=id_old_failed,
                file_name="failed_upload.zip",
                file_size=4096,
                status="failed",
                created_at=t_old_32,
                created_by=self.engineer_id,
            )
            # 2. Stale completed log (> 30 days old) -> MUST NEVER BE DELETED
            log_old_ready = Log(
                id=id_old_ready,
                file_name="historic_telemetry_2025.zip",
                file_size=8192,
                status="ready",
                drive_file_id="gdrive_historic_file_123",
                drive_url="https://drive.google.com/file/d/historic",
                created_at=t_old_45,
                created_by=self.engineer_id,
            )
            # 3. Recent logs (< 30 days old) -> MUST NOT BE DELETED
            log_recent_pending = Log(
                id=id_recent_pending,
                file_name="recent_upload.zip",
                file_size=512,
                status="pending_upload",
                created_at=t_recent,
                created_by=self.engineer_id,
            )
            log_recent_ready = Log(
                id=id_recent_ready,
                file_name="recent_telemetry.zip",
                file_size=1024,
                status="ready",
                drive_file_id="gdrive_recent_file_456",
                drive_url="https://drive.google.com/file/d/recent",
                created_at=t_recent,
                created_by=self.engineer_id,
            )
            # 4. Old soft-deleted log
            log_stale_deleted = Log(
                id=id_stale_deleted,
                file_name="already_deleted_ancient.zip",
                file_size=256,
                status="pending_upload",
                created_at=t_old_60,
                deleted_at=t_old_35,
                created_by=self.engineer_id,
            )

            # 5. Refresh tokens: expired, revoked, and valid
            id_expired_tok = uuid.uuid4()
            id_revoked_tok = uuid.uuid4()
            id_active_tok = uuid.uuid4()

            tok_expired = RefreshToken(
                id=id_expired_tok,
                user_id=self.engineer_id,
                token_hash="hash_expired",
                family_id=uuid.uuid4(),
                is_revoked=False,
                expires_at=datetime.now(UTC) - timedelta(hours=1),
            )
            tok_revoked = RefreshToken(
                id=id_revoked_tok,
                user_id=self.engineer_id,
                token_hash="hash_revoked",
                family_id=uuid.uuid4(),
                is_revoked=True,
                expires_at=datetime.now(UTC) + timedelta(days=7),
            )
            tok_active = RefreshToken(
                id=id_active_tok,
                user_id=self.engineer_id,
                token_hash="hash_active",
                family_id=uuid.uuid4(),
                is_revoked=False,
                expires_at=datetime.now(UTC) + timedelta(days=7),
            )

            session.add_all([
                log_old_pending,
                log_old_aborted,
                log_old_failed,
                log_old_ready,
                log_recent_pending,
                log_recent_ready,
                log_stale_deleted,
                tok_expired,
                tok_revoked,
                tok_active,
            ])
            await session.commit()

        # RBAC checks: viewer & engineer should be forbidden
        res_viewer = self.client.post("/api/v1/logs/cleanup", headers=self.viewer_headers)
        self.assertEqual(res_viewer.status_code, 403)

        res_eng = self.client.post("/api/v1/logs/cleanup", headers=self.eng_headers)
        self.assertEqual(res_eng.status_code, 403)

        # 1. Dry run execution with admin credentials
        dry_res = self.client.post(
            "/api/v1/logs/cleanup?retentionDays=30&dryRun=true",
            headers=self.admin_headers,
        )
        self.assertEqual(dry_res.status_code, 200)
        dry_data = dry_res.json()
        self.assertEqual(dry_data["affectedLogs"], 3)
        self.assertEqual(dry_data["orphanedCleaned"], 3)
        self.assertEqual(dry_data["softDeletedPurged"], 0)
        self.assertEqual(dry_data["tokensCleaned"], 2)
        self.assertTrue(dry_data["dryRun"])
        self.assertIn("Dry run complete", dry_data["message"])

        # Confirm dry run did not touch database rows
        async with self.session_factory() as session:
            db_pending = await session.get(Log, id_old_pending)
            self.assertIsNotNone(db_pending)
            self.assertIsNone(db_pending.deleted_at)
            self.assertIsNotNone(await session.get(RefreshToken, id_expired_tok))
            self.assertIsNotNone(await session.get(RefreshToken, id_revoked_tok))
            self.assertIsNotNone(await session.get(RefreshToken, id_active_tok))

        # 2. Real cleanup execution with admin credentials (retention = 30 days)
        clean_res = self.client.post(
            "/api/v1/logs/cleanup?retentionDays=30&dryRun=false",
            headers=self.admin_headers,
        )
        self.assertEqual(clean_res.status_code, 200)
        clean_data = clean_res.json()
        self.assertEqual(clean_data["affectedLogs"], 3)
        self.assertEqual(clean_data["orphanedCleaned"], 3)
        self.assertEqual(clean_data["tokensCleaned"], 2)
        self.assertFalse(clean_data["dryRun"])
        self.assertIn("Cleanup complete: 3 uncompleted logs soft-deleted", clean_data["message"])

        # Confirm database state after real cleanup
        async with self.session_factory() as session:
            # Stale uncompleted logs are soft-deleted
            p_log = await session.get(Log, id_old_pending)
            a_log = await session.get(Log, id_old_aborted)
            f_log = await session.get(Log, id_old_failed)
            self.assertIsNotNone(p_log.deleted_at)
            self.assertIn("[Cleaned by weekly GC", p_log.note)
            self.assertIsNotNone(a_log.deleted_at)
            self.assertIsNotNone(f_log.deleted_at)

            # Confirm stale refresh tokens were purged
            self.assertIsNone(await session.get(RefreshToken, id_expired_tok))
            self.assertIsNone(await session.get(RefreshToken, id_revoked_tok))
            self.assertIsNotNone(await session.get(RefreshToken, id_active_tok))

            # CRITICAL: Old ready telemetry log was NOT deleted
            r_old = await session.get(Log, id_old_ready)
            self.assertIsNotNone(r_old)
            self.assertIsNone(r_old.deleted_at)
            self.assertEqual(r_old.status, "ready")

            # Recent pending and ready logs were NOT deleted
            p_rec = await session.get(Log, id_recent_pending)
            self.assertIsNotNone(p_rec)
            self.assertIsNone(p_rec.deleted_at)

            r_rec = await session.get(Log, id_recent_ready)
            self.assertIsNotNone(r_rec)
            self.assertIsNone(r_rec.deleted_at)

        # 3. Cleanup with purgeSoftDeleted=true via Master API Key
        master_key = "hlp_secret_cleanup_master_key"
        master_hash = hashlib.sha256(master_key.encode("utf-8")).hexdigest()
        with patch.object(settings, "master_api_key_hash", master_hash):
            master_headers = {"X-API-Key": master_key}
            purge_res = self.client.post(
                "/api/v1/logs/cleanup?retentionDays=30&purgeSoftDeleted=true",
                headers=master_headers,
            )
            self.assertEqual(purge_res.status_code, 200)
            purge_data = purge_res.json()
            # Stale deleted log should be purged
            self.assertGreaterEqual(purge_data["softDeletedPurged"], 1)

        async with self.session_factory() as session:
            purged_item = await session.get(Log, id_stale_deleted)
            self.assertIsNone(purged_item)

    async def test_user_role_management_admin_and_master(self):
        """Verify user role promotion/demotion:
        - Common user cannot promote members (403).
        - Admin can promote a user to admin or demote to user.
        - Master Key can promote/demote directly.
        - Invalid role returns 422.
        - Listing users is restricted to admin."""
        # 1. Create a normal user with 'user' role
        target_id = uuid.uuid4()
        async with self.session_factory() as session:
            target_user = User(
                id=target_id,
                username="candidate_member",
                github_username="candidate",
                permissions=["user"],
            )
            session.add(target_user)
            await session.commit()

        # 2. Regular user (Alice) tries to promote -> 403 Forbidden
        res_forbidden = self.client.patch(
            f"/api/v1/users/{target_id}/role",
            json={"role": "admin"},
            headers=self.eng_headers,
        )
        self.assertEqual(res_forbidden.status_code, 403)

        # 3. Regular user tries to list users -> 403 Forbidden
        self.assertEqual(self.client.get("/api/v1/users", headers=self.eng_headers).status_code, 403)

        # 4. Admin promotes user to 'admin' -> 200 OK
        res_promote = self.client.patch(
            f"/api/v1/users/{target_id}/role",
            json={"role": "admin"},
            headers=self.admin_headers,
        )
        self.assertEqual(res_promote.status_code, 200)
        data = res_promote.json()
        self.assertEqual(data["role"], "admin")
        self.assertEqual(data["username"], "candidate_member")

        # Confirm DB reflects new role
        async with self.session_factory() as session:
            db_u = await session.get(User, target_id)
            self.assertEqual(db_u.permissions, ["admin"])
            self.assertEqual(db_u.role, "admin")

        # 5. Master API Key demotes user back to 'user'
        master_key = "hlp_secret_role_master_key"
        master_hash = hashlib.sha256(master_key.encode("utf-8")).hexdigest()
        with patch.object(settings, "master_api_key_hash", master_hash):
            master_headers = {"X-API-Key": master_key}
            res_demote = self.client.patch(
                f"/api/v1/users/{target_id}/role",
                json={"role": "user"},
                headers=master_headers,
            )
            self.assertEqual(res_demote.status_code, 200)
            self.assertEqual(res_demote.json()["role"], "user")

        # 6. Invalid role returns 422
        res_invalid = self.client.patch(
            f"/api/v1/users/{target_id}/role",
            json={"role": "superuser"},
            headers=self.admin_headers,
        )
        self.assertEqual(res_invalid.status_code, 422)

        # 7. Admin lists all users -> 200 OK
        res_list = self.client.get("/api/v1/users", headers=self.admin_headers)
        self.assertEqual(res_list.status_code, 200)
        user_list = res_list.json()
        usernames = [u["username"] for u in user_list]
        self.assertIn("candidate_member", usernames)
        self.assertIn("admin_charlie", usernames)

    def test_complete_upload_with_drive_file_id(self):
        """Verify that passing driveFileId in complete request directly sets file ID."""
        init_res = self.client.post(
            "/api/v1/logs/initiate",
            json={"fileName": "run_direct_id.zip", "fileSize": 2048},
            headers=self.eng_headers,
        )
        self.assertEqual(init_res.status_code, 200)
        log_id = init_res.json()["id"]

        # Complete with explicit driveFileId
        comp_res = self.client.post(
            f"/api/v1/logs/{log_id}/complete",
            json={"driveFileId": "custom_gdrive_file_abc123"},
            headers=self.eng_headers,
        )
        self.assertEqual(comp_res.status_code, 200)
        self.assertEqual(comp_res.json()["status"], "ready")

        # Check detail reflects the provided driveFileId
        detail_res = self.client.get(f"/api/v1/logs/{log_id}", headers=self.eng_headers)
        detail_data = detail_res.json()
        self.assertEqual(detail_data["driveFileId"], "custom_gdrive_file_abc123")
        self.assertIn("custom_gdrive_file_abc123", detail_data["driveUrl"])

    def test_oauth_csrf_state_validation(self):
        """Verify that OAuth callback rejects mismatched state when CSRF cookie is set."""
        # 1. Call login to receive authorizationUrl and oauth_state cookie
        login_res = self.client.get("/api/v1/auth/login")
        self.assertEqual(login_res.status_code, 200)
        state_cookie = login_res.cookies.get("oauth_state")
        self.assertIsNotNone(state_cookie)

        # 2. Call callback with tampered/wrong state -> 400 Bad Request
        bad_cb = self.client.get(
            "/api/v1/auth/callback?code=mock_code&state=tampered_state",
            cookies={"oauth_state": state_cookie},
        )
        self.assertEqual(bad_cb.status_code, 400)
        self.assertIn("CSRF validation failed", bad_cb.json()["detail"])

    def test_file_date_persistence_and_sorting(self):
        """Verify that fileDate is saved, returned in LogOut, and usable in sortBy."""
        res = self.client.post(
            "/api/v1/logs/initiate",
            json={
                "fileName": "test_dated_telemetry.zip",
                "fileSize": 1024,
                "fileDate": "2026-05-15T10:30:00Z",
                "tags": ["dated_test"],
            },
            headers=self.eng_headers,
        )
        self.assertEqual(res.status_code, 200)
        log_id = res.json()["id"]

        detail = self.client.get(f"/api/v1/logs/{log_id}", headers=self.eng_headers).json()
        self.assertIn("fileDate", detail)
        self.assertTrue(detail["fileDate"].startswith("2026-05-15"))

        # Verify sorting by fileDate
        search_res = self.client.get(
            "/api/v1/logs?sortBy=fileDate&sortOrder=desc",
            headers=self.eng_headers,
        )
        self.assertEqual(search_res.status_code, 200)

    def test_healthcheck_endpoint_healthy_and_503_degraded(self):
        """Verify that health check returns 200 when connected and 503 when database fails."""
        # 1. Healthy check returns 200
        res_ok = self.client.get("/health")
        self.assertEqual(res_ok.status_code, 200)
        self.assertEqual(res_ok.json()["status"], "healthy")
        self.assertEqual(res_ok.json()["components"]["database"], "connected")

        # 2. Degraded check returns 503 Service Unavailable
        @asynccontextmanager
        async def mock_fail_connect(*args, **kwargs):
            raise Exception("Database disk full or locked")
            yield

        with patch("sqlalchemy.ext.asyncio.AsyncEngine.connect", side_effect=mock_fail_connect):
            res_degraded = self.client.get("/health")
            self.assertEqual(res_degraded.status_code, 503)
            self.assertEqual(res_degraded.json()["status"], "degraded")
            self.assertIn("Database disk full or locked", res_degraded.json()["components"]["database"])

    async def test_refresh_token_rotation_end_to_end_sqlite(self):
        """Verify full Refresh Token Rotation lifecycle against real SQLite:
        1. Store initial active refresh token.
        2. Rotate it via POST /api/v1/auth/refresh -> receives new token, old is marked revoked with revoked_at.
        3. Attempting to reuse old revoked token within 10s grace period -> returns 401 'Refresh token was recently rotated', family NOT revoked.
        4. Legitimate new token is still valid and usable.
        5. Attempting to reuse old revoked token after 10s grace period -> revokes entire family and returns 401.
        6. Attempting to use the new token now fails because family is revoked."""
        raw_token_1 = generate_random_token(48)
        token_hash_1 = hash_token(raw_token_1)
        family_id = uuid.uuid4()
        now = datetime.now(UTC)
        expires_at = now + timedelta(days=90)

        async with self.session_factory() as session:
            tok_rec = RefreshToken(
                user_id=self.engineer_id,
                token_hash=token_hash_1,
                family_id=family_id,
                is_revoked=False,
                expires_at=expires_at,
            )
            session.add(tok_rec)
            await session.commit()

        # Step 1: Normal refresh succeeds and rotates token
        rotate_res = self.client.post(
            "/api/v1/auth/refresh",
            json={"refreshToken": raw_token_1},
        )
        self.assertEqual(rotate_res.status_code, 200)
        data = rotate_res.json()
        self.assertIn("accessToken", data)
        raw_token_2 = rotate_res.cookies.get("refresh_token")
        self.assertIsNotNone(raw_token_2)
        self.assertNotEqual(raw_token_1, raw_token_2)

        # Verify old token is revoked and revoked_at is recorded
        async with self.session_factory() as session:
            tok1_db = (
                await session.execute(
                    select(RefreshToken).where(RefreshToken.token_hash == token_hash_1)
                )
            ).scalar_one()
            self.assertTrue(tok1_db.is_revoked)
            self.assertIsNotNone(tok1_db.revoked_at)

        # Step 2: Client or concurrent tab re-uses raw_token_1 within 10s grace period
        # Returns 401 but does NOT revoke family
        grace_reuse_res = self.client.post(
            "/api/v1/auth/refresh",
            json={"refreshToken": raw_token_1},
        )
        self.assertEqual(grace_reuse_res.status_code, 401)
        self.assertEqual(
            grace_reuse_res.json()["detail"], "Refresh token was recently rotated"
        )

        # Step 3: Legitimate raw_token_2 is still active and valid to use
        rotate_res_2 = self.client.post(
            "/api/v1/auth/refresh",
            json={"refreshToken": raw_token_2},
        )
        self.assertEqual(rotate_res_2.status_code, 200)
        raw_token_3 = rotate_res_2.cookies.get("refresh_token")
        self.assertIsNotNone(raw_token_3)
        self.assertNotEqual(raw_token_2, raw_token_3)

        # Step 4: Simulate grace period expiration (> 10 seconds) on revoked token
        async with self.session_factory() as session:
            await session.execute(
                update(RefreshToken)
                .where(RefreshToken.token_hash == token_hash_1)
                .values(revoked_at=datetime.now(UTC) - timedelta(seconds=15))
            )
            await session.commit()

        # Step 5: Attacker re-uses raw_token_1 after grace period -> 401 and revokes whole family
        expired_reuse_res = self.client.post(
            "/api/v1/auth/refresh",
            json={"refreshToken": raw_token_1},
        )
        self.assertEqual(expired_reuse_res.status_code, 401)
        self.assertEqual(
            expired_reuse_res.json()["detail"], "Refresh token has been revoked"
        )

        # Step 6: Legitimate raw_token_3 is now ALSO revoked because of family revocation
        async with self.session_factory() as session:
            await session.execute(
                update(RefreshToken)
                .where(RefreshToken.family_id == family_id)
                .values(revoked_at=datetime.now(UTC) - timedelta(seconds=15))
            )
            await session.commit()

        subsequent_res = self.client.post(
            "/api/v1/auth/refresh",
            json={"refreshToken": raw_token_3},
        )
        self.assertEqual(subsequent_res.status_code, 401)
        self.assertEqual(
            subsequent_res.json()["detail"], "Refresh token has been revoked"
        )

    async def test_oauth_org_rejection_forbidden(self):
        """Verify that user not in github_org_name is rejected with 403 Forbidden."""
        with (
            patch.object(settings, "github_org_name", "Hyperloop-UPV"),
            patch("app.api.v1.auth.exchange_code_for_token", return_value="gho_mock_token"),
            patch("app.api.v1.auth.get_github_user_profile", return_value={"id": 999999, "login": "outsider"}),
            patch("app.api.v1.auth.check_github_org_membership", return_value=False),
        ):
            res = self.client.get(
                "/api/v1/auth/callback?code=valid_code&state=valid_state",
                cookies={"oauth_state": "valid_state"},
            )
            self.assertEqual(res.status_code, 403)
            self.assertIn("User is not a member", res.json()["detail"])
