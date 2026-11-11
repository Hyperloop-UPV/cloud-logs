"""Tests for app/main.py routes, exception handlers, and lifespan lifecycle."""

from contextlib import asynccontextmanager
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.exceptions import RequestValidationError
from starlette.testclient import TestClient

from app.main import (
    app,
    global_exception_handler,
    lifespan,
    validation_exception_handler,
)


class TestMainApp(IsolatedAsyncioTestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_root_endpoint(self):
        res = self.client.get("/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["service"], "Cloud-Logs API")
        self.assertEqual(data["status"], "online")

    def test_docs_and_redoc_endpoints(self):
        docs_res = self.client.get("/docs")
        self.assertEqual(docs_res.status_code, 200)
        self.assertIn("text/html", docs_res.headers["content-type"])

        redoc_res = self.client.get("/redoc")
        self.assertEqual(redoc_res.status_code, 200)
        self.assertIn("text/html", redoc_res.headers["content-type"])

    def test_openapi_endpoints(self):
        res1 = self.client.get("/openapi.json")
        self.assertEqual(res1.status_code, 200)

        res2 = self.client.get("/docs/openapi.json")
        self.assertEqual(res2.status_code, 200)

        res3 = self.client.get("/redoc/openapi.json")
        self.assertEqual(res3.status_code, 200)

    async def test_global_exception_handler_direct(self):
        request = MagicMock()
        request.method = "GET"
        request.url.path = "/crash/path"
        exc = RuntimeError("Fatal error in service")

        res = await global_exception_handler(request, exc)
        self.assertEqual(res.status_code, 500)
        import json

        body = json.loads(res.body.decode())
        self.assertEqual(body["error"], "Internal Server Error")
        self.assertIn("unexpected error", body["message"])

    async def test_validation_exception_handler_direct(self):
        request = MagicMock()
        request.method = "POST"
        request.url.path = "/validation/path"
        exc = RequestValidationError(
            errors=[
                {
                    "loc": ("body", "test_field"),
                    "msg": "field required",
                    "type": "missing",
                }
            ]
        )

        res = await validation_exception_handler(request, exc)
        self.assertEqual(res.status_code, 422)
        import json

        body = json.loads(res.body.decode())
        self.assertEqual(body["error"], "Validation Error")

    async def test_lifespan_context_manager(self):
        mock_engine = MagicMock()
        mock_engine.dispose = AsyncMock()
        mock_conn = AsyncMock()
        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_ctx.__aexit__ = AsyncMock(return_value=None)
        mock_engine.begin.return_value = mock_ctx

        with patch("app.main.engine", mock_engine):
            async with lifespan(app):
                pass

        mock_engine.begin.assert_called_once()
        mock_engine.dispose.assert_called_once()

    def test_healthcheck_endpoint_healthy_and_503_degraded(self):
        """Verify that health check returns 200 when connected and 503 when database fails."""

        @asynccontextmanager
        async def mock_ok_connect(*args, **kwargs):
            mock_conn = AsyncMock()
            yield mock_conn

        @asynccontextmanager
        async def mock_fail_connect(*args, **kwargs):
            raise Exception("Database disk full or locked")
            yield

        with patch(
            "sqlalchemy.ext.asyncio.AsyncEngine.connect", side_effect=mock_ok_connect
        ):
            for path in ("/health", "/api/v1/health"):
                res_ok = self.client.get(path)
                self.assertEqual(res_ok.status_code, 200)
                data = res_ok.json()
                self.assertEqual(data["status"], "healthy")
                self.assertEqual(data["components"]["database"], "connected")

        with patch(
            "sqlalchemy.ext.asyncio.AsyncEngine.connect", side_effect=mock_fail_connect
        ):
            for path in ("/health", "/api/v1/health"):
                res_degraded = self.client.get(path)
                self.assertEqual(res_degraded.status_code, 503)
                data = res_degraded.json()
                self.assertEqual(data["status"], "degraded")
                self.assertIn(
                    "Database disk full or locked", data["components"]["database"]
                )
