"""Unit tests for GitHub OAuth, Security, Dependencies, and Auth API routes."""

import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, MagicMock, patch

import jwt
from fastapi import HTTPException, status
from starlette.testclient import TestClient

from app.config import settings
from app.core.github import (
    check_github_org_membership,
    exchange_code_for_token,
    get_github_auth_url,
    get_github_user_profile,
)
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_token,
    verify_master_key,
)
from app.dependencies import (
    AuthContext,
    get_current_auth,
    get_current_user,
    require_permission,
)
from app.main import app
from app.models.auth import RefreshToken
from app.models.user import User


class TestSecurity(TestCase):
    def test_create_and_decode_token(self):
        payload = {"sub": str(uuid.uuid4()), "permissions": ["engineer"]}
        token = create_access_token(payload)
        decoded = decode_access_token(token)
        self.assertEqual(decoded["sub"], payload["sub"])
        self.assertEqual(decoded["permissions"], ["engineer"])
        self.assertIn("exp", decoded)
        self.assertIn("iat", decoded)

    def test_expired_token(self):
        payload = {"sub": str(uuid.uuid4())}
        token = create_access_token(payload, expires_delta=timedelta(seconds=-10))
        with self.assertRaises(jwt.ExpiredSignatureError):
            decode_access_token(token)

    def test_tampered_token(self):
        payload = {"sub": str(uuid.uuid4())}
        token = create_access_token(payload)
        tampered_token = token[:-4] + "abcd"
        with self.assertRaises(jwt.PyJWTError):
            decode_access_token(tampered_token)

    def test_hash_token(self):
        raw = "secret-token-12345"
        expected = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        self.assertEqual(hash_token(raw), expected)

    def test_verify_master_key(self):
        master_key = "hlp_live_super_secret_master_key"
        master_hash = hashlib.sha256(master_key.encode("utf-8")).hexdigest()

        with patch.object(settings, "master_api_key_hash", master_hash):
            self.assertTrue(verify_master_key(master_key))
            self.assertFalse(verify_master_key("wrong_key"))
            self.assertFalse(verify_master_key(""))

        with patch.object(settings, "master_api_key_hash", None):
            self.assertFalse(verify_master_key(master_key))


class TestGitHub(IsolatedAsyncioTestCase):
    def test_get_github_auth_url(self):
        state = "random_test_state_123"
        url = get_github_auth_url(state)
        self.assertIn("https://github.com/login/oauth/authorize?", url)
        self.assertIn("state=random_test_state_123", url)
        self.assertIn("scope=read%3Auser%2Cread%3Aorg", url)

    async def test_exchange_code_for_token_success(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"access_token": "gho_mock_token_12345"}

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_resp
            token = await exchange_code_for_token("auth_code_xyz")
            self.assertEqual(token, "gho_mock_token_12345")

    async def test_exchange_code_for_token_error(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"error": "bad_verification_code"}

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_resp
            with self.assertRaises(HTTPException) as cm:
                await exchange_code_for_token("bad_code")
            self.assertEqual(cm.exception.status_code, status.HTTP_400_BAD_REQUEST)

    async def test_get_github_user_profile_success(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "id": 1234567,
            "login": "hyperloop-user",
            "name": "Hyperloop Engineer",
        }

        with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_resp
            profile = await get_github_user_profile("gho_mock_token")
            self.assertEqual(profile["id"], 1234567)
            self.assertEqual(profile["login"], "hyperloop-user")

    async def test_check_github_org_membership(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = [
            {"login": "Hyperloop-UPV"},
            {"login": "Other-Org"},
        ]

        with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_resp

            # Case-insensitive match
            is_member = await check_github_org_membership("gho_token", "hyperloop-upv")
            self.assertTrue(is_member)

            # Not a member
            is_member = await check_github_org_membership("gho_token", "Non-Existent-Org")
            self.assertFalse(is_member)

            # None whitelist allows all
            is_member = await check_github_org_membership("gho_token", None)
            self.assertTrue(is_member)


class TestDependencies(IsolatedAsyncioTestCase):
    def test_auth_context_permissions(self):
        master_ctx = AuthContext(is_master=True)
        self.assertTrue(master_ctx.has_permission("admin"))
        self.assertTrue(master_ctx.has_permission("user"))
        self.assertTrue(master_ctx.has_permission("custom:perm"))

        admin_user = User(
            id=uuid.uuid4(),
            username="admin_user",
            permissions=["admin"],
        )
        admin_ctx = AuthContext(user=admin_user)
        self.assertTrue(admin_ctx.has_permission("admin"))
        self.assertTrue(admin_ctx.has_permission("user"))

        common_user = User(
            id=uuid.uuid4(),
            username="common_user",
            permissions=["user"],
        )
        common_ctx = AuthContext(user=common_user)
        self.assertTrue(common_ctx.has_permission("user"))
        self.assertFalse(common_ctx.has_permission("admin"))

    async def test_get_current_auth_master_key_header(self):
        master_key = "hlp_live_test_key"
        master_hash = hashlib.sha256(master_key.encode("utf-8")).hexdigest()

        request = MagicMock()
        request.headers = {"X-API-Key": master_key}
        request.client = MagicMock(host="127.0.0.1")
        request.method = "GET"
        request.url.path = "/test"

        db = AsyncMock()

        with patch.object(settings, "master_api_key_hash", master_hash):
            auth = await get_current_auth(request, db)
            self.assertTrue(auth.is_master)

    async def test_get_current_auth_master_key_bearer(self):
        master_key = "hlp_live_test_key"
        master_hash = hashlib.sha256(master_key.encode("utf-8")).hexdigest()

        request = MagicMock()
        request.headers = {"Authorization": f"Bearer {master_key}"}
        request.client = MagicMock(host="127.0.0.1")
        request.method = "POST"
        request.url.path = "/test"

        db = AsyncMock()

        with patch.object(settings, "master_api_key_hash", master_hash):
            auth = await get_current_auth(request, db)
            self.assertTrue(auth.is_master)

    async def test_get_current_auth_jwt(self):
        user_id = uuid.uuid4()
        user = User(id=user_id, username="testuser", permissions=["engineer"])
        token = create_access_token({"sub": str(user_id), "permissions": ["engineer"]})

        request = MagicMock()
        request.headers = {"Authorization": f"Bearer {token}"}
        request.client = MagicMock(host="127.0.0.1")
        request.method = "GET"
        request.url.path = "/api/v1/auth/me"

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = user

        db = AsyncMock()
        db.execute.return_value = mock_result

        with patch.object(settings, "master_api_key_hash", "some_hash"):
            auth = await get_current_auth(request, db)
            self.assertFalse(auth.is_master)
            self.assertEqual(auth.user.id, user_id)

    async def test_get_current_auth_missing_credentials(self):
        request = MagicMock()
        request.headers = {}
        db = AsyncMock()

        with self.assertRaises(HTTPException) as cm:
            await get_current_auth(request, db)
        self.assertEqual(cm.exception.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_get_current_user(self):
        user = User(id=uuid.uuid4(), username="user1", permissions=["viewer"])
        self.assertEqual(get_current_user(AuthContext(user=user)), user)

        master_user = get_current_user(AuthContext(is_master=True))
        self.assertEqual(master_user.username, "master_api_key")
        self.assertIn("admin", master_user.permissions)

    async def test_require_permission(self):
        common_user = User(id=uuid.uuid4(), username="alice", role="user")
        auth_common = AuthContext(user=common_user)

        perm_check = require_permission("user")
        result = await perm_check(auth_common)
        self.assertEqual(result, auth_common)

        admin_check = require_permission("admin")
        with self.assertRaises(HTTPException) as cm:
            await admin_check(auth_common)
        self.assertEqual(cm.exception.status_code, status.HTTP_403_FORBIDDEN)


class TestAuthAPI(IsolatedAsyncioTestCase):
    def setUp(self):
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_login_endpoint(self):
        response = self.client.get("/api/v1/auth/login")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("authorizationUrl", data)
        self.assertIn("https://github.com/login/oauth/authorize", data["authorizationUrl"])

        # Also test alias /github/login
        alias_response = self.client.get("/api/v1/auth/github/login")
        self.assertEqual(alias_response.status_code, 200)

    async def test_callback_endpoint(self):
        user_id = uuid.uuid4()
        test_user = User(
            id=user_id,
            username="octocat",
            github_username="octocat",
            github_id=583231,
            permissions=["engineer"],
        )

        mock_db = AsyncMock()
        mock_db.add = MagicMock()
        mock_scalar = MagicMock()
        mock_scalar.scalar_one_or_none.return_value = test_user
        mock_db.execute.return_value = mock_scalar

        with (
            patch("app.api.v1.auth.get_db", return_value=mock_db),
            patch("app.api.v1.auth.exchange_code_for_token", new_callable=AsyncMock) as mock_exchange,
            patch("app.api.v1.auth.get_github_user_profile", new_callable=AsyncMock) as mock_profile,
            patch("app.api.v1.auth.check_github_org_membership", new_callable=AsyncMock) as mock_org,
        ):
            mock_exchange.return_value = "gho_test_token"
            mock_profile.return_value = {"id": 583231, "login": "octocat"}
            mock_org.return_value = True

            app.dependency_overrides[get_current_auth] = lambda: AuthContext(user=test_user)
            # Use TestClient with callback
            from app.db.session import get_db as real_get_db
            app.dependency_overrides[real_get_db] = lambda: mock_db

            response = self.client.get(
                "/api/v1/auth/callback?code=mock_code&state=mock_state",
                cookies={"oauth_state": "mock_state"},
            )
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertIn("accessToken", data)
            self.assertIn("user", data)
            self.assertEqual(data["user"]["username"], "octocat")
            # Verify cookie set
            self.assertIn("refresh_token", response.cookies)

            app.dependency_overrides.clear()

    def test_callback_endpoint_csrf_failure(self):
        # 1. Calling callback without oauth_state cookie returns 400 Bad Request
        res_no_cookie = self.client.get("/api/v1/auth/callback?code=mock_code&state=mock_state")
        self.assertEqual(res_no_cookie.status_code, 400)
        self.assertIn("CSRF validation failed", res_no_cookie.json()["detail"])

        # 2. Calling callback with mismatched state returns 400 Bad Request
        res_mismatch = self.client.get(
            "/api/v1/auth/callback?code=mock_code&state=wrong_state",
            cookies={"oauth_state": "expected_state"},
        )
        self.assertEqual(res_mismatch.status_code, 400)
        self.assertIn("CSRF validation failed", res_mismatch.json()["detail"])

        # 3. Calling callback with cookie but without state query param returns 400 Bad Request
        res_no_state = self.client.get(
            "/api/v1/auth/callback?code=mock_code",
            cookies={"oauth_state": "expected_state"},
        )
        self.assertEqual(res_no_state.status_code, 400)
        self.assertIn("CSRF validation failed", res_no_state.json()["detail"])

    def test_me_endpoint_authenticated(self):
        user_id = uuid.uuid4()
        test_user = User(
            id=user_id,
            username="octocat",
            github_username="octocat",
            github_id=583231,
            permissions=["engineer"],
        )

        app.dependency_overrides[get_current_user] = lambda: test_user
        response = self.client.get("/api/v1/auth/me")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["username"], "octocat")
        self.assertEqual(data["githubUsername"], "octocat")
        self.assertNotIn("permissions", data)
        app.dependency_overrides.clear()

    def test_me_endpoint_unauthenticated(self):
        response = self.client.get("/api/v1/auth/me")
        self.assertEqual(response.status_code, 401)

    async def test_refresh_token_reuse_detection(self):
        from app.db.session import get_db as real_get_db

        user_id = uuid.uuid4()
        family_id = uuid.uuid4()
        revoked_token = RefreshToken(
            id=uuid.uuid4(),
            user_id=user_id,
            token_hash=hash_token("already_revoked_token"),
            family_id=family_id,
            is_revoked=True,
            expires_at=datetime.now(UTC) + timedelta(days=1),
        )

        mock_db = AsyncMock()
        mock_res = MagicMock()
        mock_res.scalar_one_or_none.return_value = revoked_token
        mock_db.execute.return_value = mock_res

        app.dependency_overrides[real_get_db] = lambda: mock_db
        response = self.client.post(
            "/api/v1/auth/refresh",
            json={"refreshToken": "already_revoked_token"},
        )
        self.assertEqual(response.status_code, 401)
        self.assertIn("revoked", response.json()["detail"].lower())
        app.dependency_overrides.clear()

    async def test_logout_endpoint(self):
        from app.db.session import get_db as real_get_db

        mock_db = AsyncMock()
        app.dependency_overrides[real_get_db] = lambda: mock_db

        response = self.client.post(
            "/api/v1/auth/logout",
            cookies={"refresh_token": "valid_refresh_token"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"message": "Logged out successfully"})
        app.dependency_overrides.clear()
