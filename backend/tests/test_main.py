"""Tests for app/main.py routes, exception handlers, and lifespan lifecycle."""

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
            errors=[{"loc": ("body", "test_field"), "msg": "field required", "type": "missing"}]
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
