# Cloud Logs API

Centralized telemetry and diagnostic log metadata catalog service.

---

## Key Features

- **Decoupled Google Drive Storage**:
  - Telemetry archives (ZIP files) are uploaded directly from clients to Google Drive, automatically organized into monthly subfolders (`YYYY_MM`).
  - The API server never buffers, processes, or stores large binary payloads on local disk.
- **Two-Phase Upload Workflow**:
  1. `POST /api/v1/logs/initiate`: Registers initial metadata, subsystem information (`clientMetadata`), tags, and generates a pre-authenticated Google Drive resumable upload session.
  2. Direct Client Transfer: The client streams the ZIP binary directly to Google Drive.
  3. `POST /api/v1/logs/{id}/complete`: The server verifies the file's presence and integrity in Google Drive, marking the log as `ready`.
  - `POST /api/v1/logs/{id}/abort`: Allows clients/operators to explicitly cancel pending transfers.
- **SQLite Persistence**:
  - Fully asynchronous local database engine powered by `aiosqlite` and SQLAlchemy 2.0.
  - Automatic schema and index provisioning on application startup without external database dependencies.
- **Role-Based Access Control & Authentication**:
  - **GitHub OAuth 2.0**: Validates membership within the `Hyperloop-UPV` GitHub organization.
  - **JWT & Rotating Refresh Tokens**: Short-lived access tokens (15 minutes) paired with secure `HttpOnly` refresh tokens featuring token-family reuse detection.
  - **Master API Key**: High-privilege service key (`X-API-Key` or `Authorization: Bearer <key>`) for pod on-board systems, CI/CD runners, and headless automation.
  - **Roles**: All registered team members default to `user` (common user access to upload, search, download, and manage logs). Members can be explicitly promoted to `admin` (or demoted) via `PATCH /api/v1/users/{id}/role` by existing admins or using the Master API Key.
- **Search, Sorting, Autocomplete & Statistics**:
  - Full catalog filtering by tags, author, date ranges (`startDate`, `endDate`), and full-text notes/filenames (`textQuery`).
  - Multi-field sorting (`sortBy`: `createdAt`, `startDate`, `endDate`, `fileName`, `fileSize`) and direction (`sortOrder`: `asc`, `desc`).
  - Restricted internal client metadata search (`metadataQuery`, admin-only).
  - Autocomplete endpoint (`GET /api/v1/logs/tags`) for frontend UI tagging.
  - Aggregated metrics endpoint (`GET /api/v1/logs/stats`) reporting totals, storage size, status breakdown, and top tags.
  - Direct download redirect (`GET /api/v1/logs/{id}/download` -> HTTP 307 to Google Drive).
- **Automated Catalog Maintenance & Retention Policy**:
  - Integrated, non-blocking weekly background worker (`weekly_cleanup_loop`) running alongside the API server.
  - Safely soft-deletes uncompleted or orphaned uploads (`pending_upload`, `aborted`, `failed`) older than 30 days (1 month).
  - **Inviolable Archive Guarantee**: Completed telemetry logs (`ready`) are **never deleted or modified**.
  - Manual on-demand endpoint (`POST /api/v1/logs/cleanup`) with dry-run support (`dryRun=true`).

---

## Documentation

- **[System Architecture](docs/ARCHITECTURE.md)**: Detailed sequence diagrams, SQLite ER schema, RBAC permission matrix, Google Drive hierarchy, and background worker mechanics.
- **[Frontend & Client Integration Guide](docs/API_FRONTEND.md)**: Concise REST API reference with camelCase JSON schemas, query parameters, and code examples for frontend and control tool developers.

---

## Getting Started

### 1. Prerequisites
- Python 3.11 or higher (Python 3.13 recommended).
- An active virtual environment (`venv`).

### 2. Install Dependencies
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Environment Configuration
Copy the sample environment file:
```bash
cp .env.example .env
```
Key configuration defaults:
```env
ENVIRONMENT=development
DATABASE_URL=sqlite+aiosqlite:///./data/cloud_logs.db
GDRIVE_SIMULATION_MODE=true
CLEANUP_ENABLED=true
CLEANUP_RETENTION_DAYS=30
CLEANUP_INTERVAL_HOURS=168
```
> **Note**: For local development without Google Cloud credentials, set `GDRIVE_SIMULATION_MODE=true` to simulate Google Drive sessions and URLs locally.

### 4. Run the Development Server
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
- **Interactive Swagger UI**: [http://localhost:8000/docs](http://localhost:8000/docs) (or behind reverse proxy: `/docs`)
- **ReDoc**: [http://localhost:8000/redoc](http://localhost:8000/redoc) (or behind reverse proxy: `/redoc`)
- **OpenAPI Schema**: [http://localhost:8000/openapi.json](http://localhost:8000/openapi.json)
- **Health Check**: [http://localhost:8000/api/v1/health](http://localhost:8000/api/v1/health)

---

## Production Deployment (Docker Compose)

The service is packaged as a lightweight, multi-stage Docker container designed to run on a production VPS alongside other services.

```bash
# 1. Create persistent storage directories
mkdir -p data credentials

# 2. Place your Google Service Account key
cp /path/to/service_account.json credentials/service_account.json

# 3. Configure production variables
cp .env.example .env
# Set ENVIRONMENT=production, GDRIVE_SERVICE_ACCOUNT_PATH=/app/credentials/service_account.json,
# GDRIVE_SIMULATION_MODE=false, GDRIVE_ROOT_FOLDER_ID, MASTER_API_KEY, JWT_SECRET, etc.

# 4. Start the service
docker compose up -d --build

# 5. Check container status and logs
docker compose ps
docker compose logs -f
```

---

## Running Tests

The test suite includes comprehensive unit and integration tests executing against real in-memory SQLite instances:

```bash
# Run full test suite
pytest -v

# Run with coverage report
pytest --cov=app -v
```

---

## Configuration Reference

| Environment Variable | Default | Description |
| :--- | :--- | :--- |
| `ENVIRONMENT` | `development` | App environment (`development`, `staging`, `production`) |
| `DATABASE_URL` | `sqlite+aiosqlite:///./data/cloud_logs.db` | SQLite database connection string |
| `JWT_SECRET` | *(random)* | Secret key for signing HS256 JWT tokens |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | Lifetime of access tokens in minutes |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `90` | Lifetime of refresh tokens in days |
| `MASTER_API_KEY` | `""` | Master API Key for system-level automation |
| `GITHUB_CLIENT_ID` | `""` | GitHub OAuth application Client ID |
| `GITHUB_CLIENT_SECRET` | `""` | GitHub OAuth application Client Secret |
| `GITHUB_ORG_NAME` | `Hyperloop-UPV` | Target GitHub organization for membership validation |
| `GDRIVE_SERVICE_ACCOUNT_PATH` | `""` | Path to Google Service Account JSON credentials |
| `GDRIVE_ROOT_FOLDER_ID` | `""` | ID of root Google Drive folder for telemetry archives |
| `GDRIVE_SIMULATION_MODE` | `false` | Explicitly enable local simulation of Google Drive API |
| `CLEANUP_ENABLED` | `true` | Enable automated weekly background cleanup worker |
| `CLEANUP_RETENTION_DAYS` | `30` | Retention threshold in days for uncompleted uploads |
| `CLEANUP_INTERVAL_HOURS` | `168` | Interval between cleanup background cycles (168h = 1 week) |
