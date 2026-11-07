# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

FastAPI service that catalogs Hyperloop UPV telemetry/diagnostic log metadata. Binary archives live in Google Drive; this API only stores metadata in SQLite and brokers upload sessions. Python 3.11+ (3.13 used in Docker), SQLAlchemy 2.0 async, Pydantic v2.

## Commands

```bash
# Setup (no venv is checked in; deps are not installed system-wide)
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt        # includes requirements.txt + pytest

# Dev server (http://localhost:8000/docs, /redoc, /api/v1/health)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Tests
pytest -v
pytest --cov=app -v
pytest tests/test_logs.py -v                                   # one file
pytest tests/test_logs.py::TestLogsAPI::test_<name> -v         # one test
pytest -k "refresh" -v                                         # by name

# Lint (ruff is configured in pyproject.toml but not in requirements-dev.txt)
ruff check . && ruff format --check .

# Production
docker compose up -d --build && docker compose logs -f
```

Local development without Google credentials requires `GDRIVE_SIMULATION_MODE=true` in `.env` (copy from `.env.example`); otherwise every Drive call raises 503. `cloud_logs.db` is created on first startup — there are no migrations (see below).

## Architecture

Request flow: `app/main.py` → `app/api/v1/__init__.py` (router registry, mounted at `/api/v1`) → endpoint module → `app/core/*` services → `app/models/*` via the `get_db` session.

Layers:
- `app/api/v1/` — `auth.py` (GitHub OAuth, refresh rotation, logout, `/me`), `logs.py` (the bulk of the domain logic), `users.py` (listing + role changes).
- `app/core/` — `security.py` (JWT, token hashing, master-key compare), `github.py` (OAuth exchange + org membership), `gdrive.py` (`GoogleDriveService`), `cleanup.py` (`execute_cleanup`).
- `app/schemas/` — Pydantic request/response models, all inheriting `CamelModel` (`app/schemas/base.py`).
- `app/models/` + `app/db/` — ORM models and the async engine/session.

### Two-phase upload

The server never touches the ZIP bytes. `POST /logs/initiate` writes a `pending_upload` row, asks Drive for a resumable session inside a `YYYY_MM` folder (`get_year_month_folder`), and returns `uploadUrl`. The client PUTs the binary to Drive directly. `POST /logs/{id}/complete` calls `verify_uploaded_file` and flips the row to `ready`; `/abort` marks it `aborted`. Statuses: `pending_upload`, `ready`, `aborted`, `failed`. Deletes are soft (`deleted_at`); every query filters `Log.deleted_at.is_(None)`.

`GoogleDriveService.simulation_mode` short-circuits each Drive method with fabricated URLs/IDs, so the whole workflow is testable without credentials. The module-level `gdrive_service` singleton is injected through `get_gdrive_service` — override that dependency in tests rather than patching httpx.

### Auth and RBAC

`get_current_auth` (`app/dependencies.py`) resolves every request to an `AuthContext` from, in order: `X-API-Key` master key, `Authorization: Bearer <master key>`, or `Authorization: Bearer <JWT>` (which is looked up against the `users` table). There are exactly two effective levels: `user` and `admin`, plus master key (`is_master`, which satisfies everything). `require_permission("user")` therefore means "any authenticated caller" and `require_permission("admin")` means admin-or-master.

Historical "permissions list" naming survives as compatibility shims — `AuthContext.permissions`, `User.permissions` (a read-only property returning `[role]`), and `User.__init__` accepting `permissions=[...]` to derive `role`. The column is `role`; don't build new logic on the list form. `get_current_user` synthesizes a non-persisted admin `User` with UUID `0000...0000` for master-key callers, so endpoints that need a real row must check `auth.user` explicitly (see `users.py::get_current_user_profile`).

Ownership (IDOR) checks are separate from the role dependency and must be written per endpoint: `logs.py::check_log_modification_permission` (owner, admin, or master) and the inline self-only check in `users.py::get_user_detail`.

Refresh tokens are opaque random strings stored as SHA-256 hashes with a `family_id`. Rotation revokes the old row and inserts a new one in the same family; reusing a revoked token revokes the entire family, except within a 10-second grace window that returns 401 without nuking the family. The cookie is scoped to `path=/api/v1/auth` and `secure` is off only when `ENVIRONMENT=development`.

### Persistence

`app/db/engine.py` sets WAL, `synchronous=NORMAL`, `foreign_keys=ON`, and a 5s busy timeout on every SQLite connect, and echoes SQL when `ENVIRONMENT=development`. Schema comes from `Base.metadata.create_all` in the `lifespan` hook — **there is no Alembic**, so a changed column on an existing `data/cloud_logs.db` will not be applied; delete/recreate the file or write the DDL by hand. `app/models/__init__.py` must import every model so it registers on `Base.metadata`.

`get_db` commits on clean exit and rolls back on exception, so endpoints usually need no explicit `commit()` (some call it anyway before `db.refresh`).

## Conventions and gotchas

- **camelCase at the HTTP boundary, snake_case inside.** Schemas use `CamelModel` (alias generator + `from_attributes`), and query params declare explicit aliases (`pageSize`, `textQuery`, `sortBy`, …). Add the alias when adding a param.
- **Route order matters in `logs.py`.** `/tags`, `/stats`, and `/cleanup` are declared before `/{log_id}`; a new literal subpath added after it will be swallowed by the UUID route.
- **`ruff` lint config** ignores `B008`/`TRY002` and whitelists `Depends`/`Query`/`require_permission` as immutable calls — keep dependency defaults in signatures.
- **Tests use stdlib `unittest`**, not pytest fixtures, and there is no `conftest.py`. Two patterns: `TestCase` + `TestClient` with `app.dependency_overrides` pointing at `AsyncMock` DB sessions (`test_logs.py`, `test_auth.py`, `test_users.py`), and `IsolatedAsyncioTestCase` creating a fresh in-memory SQLite engine per test (`test_sqlite_integration.py`). Always `app.dependency_overrides.clear()` in teardown.
- **`CLEANUP_ENABLED` / `CLEANUP_INTERVAL_HOURS` are read but unused.** The README and `docs/ARCHITECTURE.md` describe a `weekly_cleanup_loop` background worker; no such task exists in the code. `execute_cleanup` is only reachable through `POST /api/v1/logs/cleanup` (admin, supports `dryRun`). Starting that loop in `lifespan` is unimplemented work, not a regression to hunt for.
- **Deployment runs a single uvicorn worker** behind nginx (see `docs/nginx.conf.example`) because SQLite plus in-process Drive token/folder caches assume one process. `/docs`, `/redoc`, and `/openapi.json` are hand-rolled in `main.py` with relative URLs so they survive a reverse-proxy prefix.
- Secrets live in `.env` (gitignored) and `credentials/service_account.json`; `data/` and `credentials/` contents are gitignored except `.gitkeep`.

## Reference docs

`docs/ARCHITECTURE.md` — sequence diagrams, ER schema, RBAC matrix, Drive hierarchy. `docs/API_FRONTEND.md` — endpoint-by-endpoint REST reference with camelCase payloads, written for frontend/control-tool clients. Keep both in sync when changing the API surface.
