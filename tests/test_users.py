"""Tests for User Management API and RBAC boundaries."""

import hashlib
import uuid
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from starlette.testclient import TestClient

from app.config import settings
from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.user import User


class TestUsersAPI(IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        self.session_factory = async_sessionmaker(
            self.engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )

        self.user_id = uuid.uuid4()
        self.other_user_id = uuid.uuid4()
        self.admin_id = uuid.uuid4()

        async with self.session_factory() as session:
            self.user = User(
                id=self.user_id,
                username="standard_user",
                role="user",
            )
            self.other_user = User(
                id=self.other_user_id,
                username="another_user",
                role="user",
            )
            self.admin = User(
                id=self.admin_id,
                username="admin_user",
                role="admin",
            )
            session.add_all([self.user, self.other_user, self.admin])
            await session.commit()

        async def override_get_db():
            async with self.session_factory() as session:
                yield session

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

        self.user_token = create_access_token(
            {"sub": str(self.user_id), "role": "user"}
        )
        self.admin_token = create_access_token(
            {"sub": str(self.admin_id), "role": "admin"}
        )

        self.user_headers = {"Authorization": f"Bearer {self.user_token}"}
        self.admin_headers = {"Authorization": f"Bearer {self.admin_token}"}
        self.master_key = "shield_test_master_key_123"
        self.master_hash = hashlib.sha256(self.master_key.encode("utf-8")).hexdigest()
        self.master_headers = {"X-API-Key": self.master_key}

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        await self.engine.dispose()

    def test_get_current_user_me_authenticated(self):
        """GET /api/v1/users/me returns the profile of the caller."""
        res = self.client.get("/api/v1/users/me", headers=self.user_headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["username"], "standard_user")
        self.assertEqual(data["role"], "user")
        self.assertEqual(data["id"], str(self.user_id))

    def test_get_current_user_me_unauthenticated(self):
        """GET /api/v1/users/me requires authentication."""
        res = self.client.get("/api/v1/users/me")
        self.assertEqual(res.status_code, 401)

    def test_list_users_as_admin(self):
        """GET /api/v1/users is allowed for administrators."""
        res = self.client.get("/api/v1/users", headers=self.admin_headers)
        self.assertEqual(res.status_code, 200)
        users = res.json()
        self.assertGreaterEqual(len(users), 3)
        usernames = [u["username"] for u in users]
        self.assertIn("standard_user", usernames)
        self.assertIn("admin_user", usernames)

    def test_list_users_as_master_key(self):
        """GET /api/v1/users is allowed with Master API Key."""
        with patch.object(settings, "master_api_key_hash", self.master_hash):
            res = self.client.get("/api/v1/users", headers=self.master_headers)
            self.assertEqual(res.status_code, 200)

    def test_list_users_as_standard_user_forbidden(self):
        """GET /api/v1/users is forbidden for non-admin users."""
        res = self.client.get("/api/v1/users", headers=self.user_headers)
        self.assertEqual(res.status_code, 403)

    def test_get_user_by_id_own_profile(self):
        """Users can read their own profile via /users/{id}."""
        res = self.client.get(f"/api/v1/users/{self.user_id}", headers=self.user_headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["username"], "standard_user")

    def test_get_user_by_id_other_profile_as_user_forbidden(self):
        """Non-admin users cannot read another user's profile via /users/{id}."""
        res = self.client.get(f"/api/v1/users/{self.other_user_id}", headers=self.user_headers)
        self.assertEqual(res.status_code, 403)

    def test_get_user_by_id_other_profile_as_admin_allowed(self):
        """Admins can read any user's profile via /users/{id}."""
        res = self.client.get(f"/api/v1/users/{self.other_user_id}", headers=self.admin_headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["username"], "another_user")

    def test_get_user_by_id_not_found(self):
        """GET /api/v1/users/{random_id} returns 404 for admins."""
        random_id = uuid.uuid4()
        res = self.client.get(f"/api/v1/users/{random_id}", headers=self.admin_headers)
        self.assertEqual(res.status_code, 404)

    def test_update_user_role_as_user_forbidden(self):
        """Standard users cannot change roles."""
        res = self.client.patch(
            f"/api/v1/users/{self.user_id}/role",
            json={"role": "admin"},
            headers=self.user_headers,
        )
        self.assertEqual(res.status_code, 403)

    def test_update_user_role_as_admin_success(self):
        """Admins can promote standard users to admin."""
        res = self.client.patch(
            f"/api/v1/users/{self.other_user_id}/role",
            json={"role": "admin"},
            headers=self.admin_headers,
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["role"], "admin")

    def test_update_user_role_as_master_key_success(self):
        """Master API Key can update user roles."""
        with patch.object(settings, "master_api_key_hash", self.master_hash):
            res = self.client.patch(
                f"/api/v1/users/{self.other_user_id}/role",
                json={"role": "admin"},
                headers=self.master_headers,
            )
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["role"], "admin")

    def test_update_user_role_invalid_role(self):
        """Reject roles other than 'user' and 'admin'."""
        res = self.client.patch(
            f"/api/v1/users/{self.other_user_id}/role",
            json={"role": "viewer"},
            headers=self.admin_headers,
        )
        self.assertEqual(res.status_code, 422)

    def test_update_user_role_not_found(self):
        """Update role for non-existent user returns 404."""
        random_id = uuid.uuid4()
        res = self.client.patch(
            f"/api/v1/users/{random_id}/role",
            json={"role": "admin"},
            headers=self.admin_headers,
        )
        self.assertEqual(res.status_code, 404)
