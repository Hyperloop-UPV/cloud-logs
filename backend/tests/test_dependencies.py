"""Unit and integration tests for authentication dependencies, RBAC context, and security helpers."""

import uuid
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, MagicMock, patch

import jwt
from fastapi import HTTPException, status

from app.config import settings
from app.core.security import (
    create_access_token,
    decode_access_token,
    get_refresh_token_expiry,
    log_master_key_usage,
)
from app.dependencies import (
    AuthContext,
    get_current_auth,
    get_current_user,
    require_permission,
    require_role,
)
from app.models.user import User


def make_mock_request(
    headers: dict | None = None,
    query_params: dict | None = None,
    client_ip: str | None = "127.0.0.1",
    method: str = "GET",
    path: str = "/api/v1/logs",
) -> MagicMock:
    request = MagicMock()
    request.headers = headers if headers is not None else {}
    request.query_params = query_params if query_params is not None else {}
    request.client = MagicMock(host=client_ip) if client_ip else None
    request.method = method
    request.url.path = path
    return request


class TestAuthContext(TestCase):
    def test_auth_context_defaults_with_no_user(self):
        ctx = AuthContext(user=None, is_master=False)
        self.assertEqual(ctx.role, "user")
        self.assertEqual(ctx.permissions, ["user"])
        self.assertTrue(ctx.has_permission("user"))
        self.assertFalse(ctx.has_permission("admin"))
        self.assertTrue(ctx.has_role("user"))
        self.assertFalse(ctx.has_role("admin"))

    def test_auth_context_master_key(self):
        ctx = AuthContext(user=None, is_master=True)
        self.assertEqual(ctx.role, "admin")
        self.assertEqual(ctx.permissions, ["*"])
        self.assertTrue(ctx.has_permission("admin"))
        self.assertTrue(ctx.has_permission("user"))
        self.assertTrue(ctx.has_permission("anything_else"))
        self.assertTrue(ctx.has_role("admin"))
        self.assertTrue(ctx.has_role("operator"))

    def test_auth_context_admin_user(self):
        admin = User(id=uuid.uuid4(), username="admin_usr", role="admin")
        ctx = AuthContext(user=admin, is_master=False)
        self.assertEqual(ctx.role, "admin")
        self.assertEqual(ctx.permissions, ["admin"])
        self.assertTrue(ctx.has_permission("admin"))
        self.assertTrue(ctx.has_permission("user"))
        self.assertTrue(ctx.has_permission("custom_role"))
        self.assertTrue(ctx.has_role("admin"))

    def test_auth_context_standard_user(self):
        user = User(id=uuid.uuid4(), username="norm_usr", role="operator")
        ctx = AuthContext(user=user, is_master=False)
        self.assertEqual(ctx.role, "operator")
        self.assertEqual(ctx.permissions, ["operator"])
        self.assertTrue(ctx.has_permission("operator"))
        self.assertTrue(ctx.has_permission("user"))
        self.assertFalse(ctx.has_permission("admin"))
        self.assertTrue(ctx.has_role("operator"))
        self.assertFalse(ctx.has_role("admin"))


class TestGetCurrentAuthDependency(IsolatedAsyncioTestCase):
    async def test_x_api_key_valid_master(self):
        master_key = "test_valid_master_api_key"
        request = make_mock_request(
            headers={"X-API-Key": master_key},
            client_ip="10.0.0.1",
        )
        db = AsyncMock()

        with patch("app.dependencies.verify_master_key", return_value=True):
            auth = await get_current_auth(request, db)
            self.assertTrue(auth.is_master)
            self.assertIsNone(auth.user)

    async def test_x_api_key_valid_master_without_client(self):
        request = make_mock_request(
            headers={"X-API-Key": "key"},
            client_ip=None,
            method="POST",
        )
        db = AsyncMock()

        with patch("app.dependencies.verify_master_key", return_value=True):
            auth = await get_current_auth(request, db)
            self.assertTrue(auth.is_master)

    async def test_x_api_key_invalid(self):
        request = make_mock_request(headers={"X-API-Key": "invalid_master_key"})
        db = AsyncMock()

        with patch("app.dependencies.verify_master_key", return_value=False):
            with self.assertRaises(HTTPException) as cm:
                await get_current_auth(request, db)
            self.assertEqual(cm.exception.status_code, status.HTTP_401_UNAUTHORIZED)
            self.assertEqual(cm.exception.detail, "Invalid API key")
            self.assertEqual(cm.exception.headers.get("WWW-Authenticate"), "ApiKey")

    async def test_missing_credentials(self):
        request = make_mock_request()
        db = AsyncMock()

        with self.assertRaises(HTTPException) as cm:
            await get_current_auth(request, db)
        self.assertEqual(cm.exception.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(cm.exception.detail, "Missing authentication credentials")
        self.assertEqual(cm.exception.headers.get("WWW-Authenticate"), "Bearer")

    async def test_invalid_authorization_scheme_basic(self):
        request = make_mock_request(headers={"Authorization": "Basic dXNlcjpwYXNz"})
        db = AsyncMock()

        with self.assertRaises(HTTPException) as cm:
            await get_current_auth(request, db)
        self.assertEqual(cm.exception.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertIn("Invalid authorization scheme", cm.exception.detail)

    async def test_invalid_authorization_scheme_no_space(self):
        request = make_mock_request(
            headers={"Authorization": "BearerTokenWithoutSpace"}
        )
        db = AsyncMock()

        with self.assertRaises(HTTPException) as cm:
            await get_current_auth(request, db)
        self.assertEqual(cm.exception.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertIn("Invalid authorization scheme", cm.exception.detail)

    async def test_bearer_empty_token(self):
        request = make_mock_request(headers={"Authorization": "Bearer   "})
        db = AsyncMock()

        with self.assertRaises(HTTPException) as cm:
            await get_current_auth(request, db)
        self.assertEqual(cm.exception.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(cm.exception.detail, "Missing authentication credentials")

    async def test_query_param_token_empty(self):
        request = make_mock_request(query_params={"token": "   "})
        db = AsyncMock()

        with self.assertRaises(HTTPException) as cm:
            await get_current_auth(request, db)
        self.assertEqual(cm.exception.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(cm.exception.detail, "Missing authentication credentials")

    async def test_bearer_master_key(self):
        request = make_mock_request(
            headers={"Authorization": "Bearer master_secret_val"},
            client_ip="192.168.1.100",
        )
        db = AsyncMock()

        with patch("app.dependencies.verify_master_key", return_value=True):
            auth = await get_current_auth(request, db)
            self.assertTrue(auth.is_master)

    async def test_query_param_token_success(self):
        user_id = uuid.uuid4()
        user = User(id=user_id, username="query_user", role="user")
        token = create_access_token({"sub": str(user_id)})

        request = make_mock_request(query_params={"token": token})
        db = AsyncMock()
        res = MagicMock()
        res.scalar_one_or_none.return_value = user
        db.execute.return_value = res

        with patch("app.dependencies.verify_master_key", return_value=False):
            auth = await get_current_auth(request, db)
            self.assertFalse(auth.is_master)
            self.assertEqual(auth.user, user)

    async def test_jwt_expired_signature_error(self):
        request = make_mock_request(
            headers={"Authorization": "Bearer some_expired_token"}
        )
        db = AsyncMock()

        with (
            patch("app.dependencies.verify_master_key", return_value=False),
            patch(
                "app.dependencies.decode_access_token",
                side_effect=jwt.ExpiredSignatureError("Token has expired"),
            ),
        ):
            with self.assertRaises(HTTPException) as cm:
                await get_current_auth(request, db)
            self.assertEqual(cm.exception.status_code, status.HTTP_401_UNAUTHORIZED)
            self.assertEqual(cm.exception.detail, "Access token has expired")

    async def test_jwt_decode_error(self):
        request = make_mock_request(
            headers={"Authorization": "Bearer some_corrupt_token"}
        )
        db = AsyncMock()

        with (
            patch("app.dependencies.verify_master_key", return_value=False),
            patch(
                "app.dependencies.decode_access_token",
                side_effect=jwt.DecodeError("Malformed JWT"),
            ),
        ):
            with self.assertRaises(HTTPException) as cm:
                await get_current_auth(request, db)
            self.assertEqual(cm.exception.status_code, status.HTTP_401_UNAUTHORIZED)
            self.assertEqual(cm.exception.detail, "Invalid access token")

    async def test_jwt_missing_sub(self):
        request = make_mock_request(
            headers={"Authorization": "Bearer some_valid_token"}
        )
        db = AsyncMock()

        with (
            patch("app.dependencies.verify_master_key", return_value=False),
            patch(
                "app.dependencies.decode_access_token", return_value={"role": "user"}
            ),
        ):
            with self.assertRaises(HTTPException) as cm:
                await get_current_auth(request, db)
            self.assertEqual(cm.exception.status_code, status.HTTP_401_UNAUTHORIZED)
            self.assertEqual(cm.exception.detail, "Invalid access token payload")

    async def test_jwt_invalid_uuid_sub(self):
        request = make_mock_request(
            headers={"Authorization": "Bearer some_valid_token"}
        )
        db = AsyncMock()

        with (
            patch("app.dependencies.verify_master_key", return_value=False),
            patch(
                "app.dependencies.decode_access_token",
                return_value={"sub": "not-a-valid-uuid"},
            ),
        ):
            with self.assertRaises(HTTPException) as cm:
                await get_current_auth(request, db)
            self.assertEqual(cm.exception.status_code, status.HTTP_401_UNAUTHORIZED)
            self.assertEqual(cm.exception.detail, "Invalid user identifier in token")

    async def test_jwt_user_not_found_in_database(self):
        user_uuid = uuid.uuid4()
        request = make_mock_request(
            headers={"Authorization": "Bearer some_valid_token"}
        )

        mock_res = MagicMock()
        mock_res.scalar_one_or_none.return_value = None
        db = AsyncMock()
        db.execute.return_value = mock_res

        with (
            patch("app.dependencies.verify_master_key", return_value=False),
            patch(
                "app.dependencies.decode_access_token",
                return_value={"sub": str(user_uuid)},
            ),
        ):
            with self.assertRaises(HTTPException) as cm:
                await get_current_auth(request, db)
            self.assertEqual(cm.exception.status_code, status.HTTP_401_UNAUTHORIZED)
            self.assertEqual(cm.exception.detail, "User not found")


class TestGetCurrentUserDependency(TestCase):
    def test_get_current_user_with_user_context(self):
        u = User(id=uuid.uuid4(), username="direct_user", role="user")
        ctx = AuthContext(user=u)
        self.assertEqual(get_current_user(ctx), u)

    def test_get_current_user_with_master_key(self):
        ctx = AuthContext(is_master=True)
        user = get_current_user(ctx)
        self.assertEqual(user.id, uuid.UUID("00000000-0000-0000-0000-000000000000"))
        self.assertEqual(user.username, "master_api_key")
        self.assertEqual(user.github_username, "system")
        self.assertEqual(user.role, "admin")

    def test_get_current_user_unauthenticated_raises(self):
        ctx = AuthContext(user=None, is_master=False)
        with self.assertRaises(HTTPException) as cm:
            get_current_user(ctx)
        self.assertEqual(cm.exception.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(cm.exception.detail, "Not authenticated")


class TestRequirePermissionAndRole(IsolatedAsyncioTestCase):
    def test_require_role_is_require_permission_alias(self):
        self.assertIs(require_role, require_permission)

    async def test_require_permission_success_user(self):
        user = User(id=uuid.uuid4(), username="test_usr", role="user")
        ctx = AuthContext(user=user)
        dep = require_permission("user")
        res = await dep(auth=ctx)
        self.assertEqual(res, ctx)

    async def test_require_permission_success_admin(self):
        admin = User(id=uuid.uuid4(), username="admin_usr", role="admin")
        ctx = AuthContext(user=admin)
        dep = require_permission("admin")
        res = await dep(auth=ctx)
        self.assertEqual(res, ctx)

        custom_dep = require_permission("engineer")
        res_custom = await custom_dep(auth=ctx)
        self.assertEqual(res_custom, ctx)

    async def test_require_permission_failure_forbidden(self):
        user = User(id=uuid.uuid4(), username="norm_usr", role="user")
        ctx = AuthContext(user=user)
        dep = require_permission("admin")

        with self.assertRaises(HTTPException) as cm:
            await dep(auth=ctx)
        self.assertEqual(cm.exception.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(cm.exception.detail, "Operation requires 'admin' permission")


class TestSecurityHelpers(TestCase):
    def test_log_master_key_usage_with_x_forwarded_for(self):
        request = make_mock_request(
            headers={
                "x-forwarded-for": "198.51.100.42, 10.0.0.1",
                "user-agent": "CustomAgent/1.0",
            },
            client_ip="10.0.0.1",
            method="POST",
        )

        with patch("app.core.security.logger.warning") as mock_warn:
            log_master_key_usage(request)
            mock_warn.assert_called_once()
            args = mock_warn.call_args[0]
            self.assertEqual(args[3], "198.51.100.42")
            self.assertEqual(args[4], "CustomAgent/1.0")

    def test_log_master_key_usage_without_forwarded(self):
        request = make_mock_request(
            client_ip="172.16.0.5",
            path="/api/v1/users",
        )

        with patch("app.core.security.logger.warning") as mock_warn:
            log_master_key_usage(request)
            mock_warn.assert_called_once()
            args = mock_warn.call_args[0]
            self.assertEqual(args[3], "172.16.0.5")
            self.assertEqual(args[4], "unknown")

    def test_log_master_key_usage_no_client(self):
        request = make_mock_request(
            client_ip=None,
            method="DELETE",
            path="/api/v1/logs/1",
        )

        with patch("app.core.security.logger.warning") as mock_warn:
            log_master_key_usage(request)
            mock_warn.assert_called_once()
            args = mock_warn.call_args[0]
            self.assertEqual(args[3], "unknown")

    def test_create_access_token_with_user_id_and_username(self):
        uid = uuid.uuid4()
        token = create_access_token(
            user_id_or_data=uid, username="test_name", role="admin"
        )
        decoded = decode_access_token(token)
        self.assertEqual(decoded["sub"], str(uid))
        self.assertEqual(decoded["username"], "test_name")
        self.assertEqual(decoded["role"], "admin")
        self.assertEqual(decoded["permissions"], ["admin"])

    def test_create_access_token_with_permissions_only(self):
        token_admin = create_access_token({"sub": "123"}, permissions=["admin", "user"])
        decoded_admin = decode_access_token(token_admin)
        self.assertEqual(decoded_admin["role"], "admin")

        token_user = create_access_token({"sub": "123"}, permissions=["operator"])
        decoded_user = decode_access_token(token_user)
        self.assertEqual(decoded_user["role"], "user")

    def test_decode_access_token_empty_raises(self):
        with self.assertRaises(jwt.InvalidTokenError):
            decode_access_token("")

    def test_get_refresh_token_expiry(self):
        exp = get_refresh_token_expiry()
        self.assertIsNotNone(exp)
        self.assertIsNotNone(exp.tzinfo)

    def test_verify_master_key_plain_and_hash(self):
        from app.core.security import verify_master_key

        with patch.object(settings, "master_api_key", "plain_secret_key"):
            self.assertTrue(verify_master_key("plain_secret_key"))
            self.assertFalse(verify_master_key("wrong_key"))
