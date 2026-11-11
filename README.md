# Hyperloop UPV — Cloud Logs

Centralized telemetry and diagnostic log catalog service and web exploration platform for the **Hyperloop UPV** pod.

This repository is structured as a **monorepo** consisting of an asynchronous FastAPI backend service, an interactive React frontend single-page application, and shared system architecture documentation.

---

## Repository Structure

```text
cloud-logs/
├── backend/                  # FastAPI backend service
│   ├── app/                  # Application code (API v1, core services, models, schemas)
│   ├── tests/                # Automated pytest integration & unit tests
│   ├── data/                 # Local SQLite database volume (cloud_logs.db)
│   ├── credentials/          # Google Cloud Service Account credentials
│   ├── Dockerfile            # Production container build
│   ├── requirements.txt      # Production Python dependencies
│   ├── requirements-dev.txt  # Development & test dependencies (pytest, ruff)
│   └── README.md             # Backend detailed documentation
│
├── frontend/                 # React 19 web application
│   ├── src/                  # Application code (features, components, routes, API client)
│   ├── public/               # Static assets & brand marks
│   ├── package.json          # Node dependencies & build scripts
│   └── README.md             # Frontend detailed documentation
│
├── docs/                     # Global system documentation & specifications
│   ├── ARCHITECTURE.md       # Complete system architecture, workflows, and diagrams
│   ├── API_FRONTEND.md       # API reference, request/response schemas, and integration guide
│   └── SETUP.md              # Google Cloud & GitHub OAuth setup instructions
│
├── docker-compose.yml        # Production container orchestration
└── README.md                 # Monorepo overview and quickstart (this file)
```

---

## Architecture Overview

```mermaid
graph TD
    Client["Pod / Control Station / CI"] -->|1. Initiate Upload| API["Backend API (FastAPI)"]
    API -->|Generate Session| GDrive[("Google Drive Storage<br/>(YYYY_MM monthly archives)")]
    Client -->|2. Direct Binary Transfer (ZIP)| GDrive
    Client -->|3. Complete Upload| API
    API -->|Verify Size & Hash| GDrive
    API -->|Store Metadata| SQLite[("SQLite Database<br/>(aiosqlite + WAL)")]

    Browser["Web Browser (Operator)"] -->|HTTP / SPA| Frontend["Frontend UI (React 19 + Vite)"]
    Frontend -->|REST API Calls| API
    Browser -->|Direct Download (HTTP 307)| GDrive
```

- **Decoupled Binary Storage**: Large telemetry archives (`.zip`) stream directly between clients and Google Drive. The API server brokers sessions and verifies integrity without storing large binaries on host disks.
- **Async Metadata Catalog**: Powered by SQLite (`aiosqlite`) and SQLAlchemy 2.0 with WAL mode enabled for fast catalog searches, tag indexing, and automated retention policies.
- **Security & RBAC**: GitHub OAuth 2.0 with organization validation (`Hyperloop-UPV`), rotating JWT refresh tokens, and Master API Key for automated pod clients.
- **Dense Scientific Interface**: Built with Tailwind v4, TanStack Query, and force-directed graph visualizers to inspect mission logs, telemetry tags, and sensor metrics.

---

## Quickstart (Local Development)

### 1. Start the Backend

From the repository root:

```bash
# Navigate to the backend
cd backend

# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements-dev.txt

# Configure environment (copy default example with simulation mode enabled)
cp .env.example .env

# Start development server (runs at http://localhost:8000)
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

> **Simulation Mode**: By default, `GDRIVE_SIMULATION_MODE=true` in `.env.example`, allowing local development and testing without Google Cloud service account credentials.

API Documentation is interactively available at:
- **Swagger UI**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc**: [http://localhost:8000/redoc](http://localhost:8000/redoc)
- **Health check**: [http://localhost:8000/api/v1/health](http://localhost:8000/api/v1/health)

### 2. Start the Frontend

In a separate terminal:

```bash
# Navigate to the frontend
cd frontend

# Install Node dependencies
npm install

# Start Vite development server (runs at http://localhost:5173)
npm run dev
```

The frontend automatically proxies `/api` requests to `http://localhost:8000`.

---

## Production Deployment (Docker Compose)

The backend service is containerized for production deployment:

```bash
# 1. Prepare persistent storage and credentials in backend/
mkdir -p backend/data backend/credentials

# 2. Place your Google Cloud service account JSON key
cp /path/to/service_account.json backend/credentials/service_account.json

# 3. Create production environment file
cp backend/.env.example backend/.env
# Configure: ENVIRONMENT=production, GDRIVE_SIMULATION_MODE=false,
# GDRIVE_ROOT_FOLDER_ID, MASTER_API_KEY, JWT_SECRET, GITHUB_CLIENT_ID, etc.

# 4. Start the stack from the repository root
docker compose up -d --build

# 5. Inspect status and logs
docker compose ps
docker compose logs -f
```

---

## Testing & Code Quality

Both packages feature standalone test and lint suites:

### Backend Testing & Linting

```bash
cd backend
source .venv/bin/activate

# Run test suite (117 tests with in-memory SQLite)
pytest -v

# Run with test coverage
pytest --cov=app -v

# Run linter & formatter checks
ruff check . && ruff format --check .
```

### Frontend Verification

```bash
cd frontend

# Runs Prettier check, Oxlint, and TypeScript production build
npm run check
```

---

## Documentation Index

- **[System Architecture](docs/ARCHITECTURE.md)**: Deep dive into the two-phase upload flow, database ER model, permissions matrix, and background cleanup workers.
- **[Frontend & API Integration Guide](docs/API_FRONTEND.md)**: Exhaustive REST endpoint specification, camelCase parameter definitions, and status codes.
- **[Setup & Cloud Credentials Guide](docs/SETUP.md)**: Step-by-step instructions for Google Cloud Console, Google Drive Shared Folders, and GitHub OAuth Apps.
- **[Backend Service Guide](backend/README.md)**: Backend-specific setup, internal layers, and SQLite engine configuration.
- **[Frontend Application Guide](frontend/README.md)**: Frontend architecture, state management, routes, and UI design decisions.
