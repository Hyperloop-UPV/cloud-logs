# CLAUDE.md (Monorepo)

This repository is a monorepo consisting of the telemetry catalog service and web exploration platform for Hyperloop UPV.

## Monorepo Layout

- `backend/` — FastAPI service in Python 3.11+, SQLAlchemy 2.0 async, SQLite, and Google Drive upload brokering.
  - See `backend/CLAUDE.md` and `backend/README.md` for backend-specific architecture, commands, and rules.
- `frontend/` — Single-page React 19 application (Vite, TypeScript, Tailwind v4, TanStack Query, React Router 7).
  - See `frontend/CLAUDE.md` and `frontend/README.md` for frontend-specific architecture, routes, and UI design rules.
- `docs/` — Shared architecture diagrams, API specs (`docs/API_FRONTEND.md`), and infrastructure setup guides.

## Common Commands

### Backend (`cd backend`)
```bash
# Setup
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt

# Dev server (http://localhost:8000)
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Tests & Linting
pytest -v
ruff check . && ruff format --check .
```

### Frontend (`cd frontend`)
```bash
# Setup & Dev server (http://localhost:5173)
npm install
npm run dev

# Verification & Build
npm run check      # Runs format check, oxlint, and tsc -b && vite build
```

### Production Docker (`from root`)
```bash
docker compose up -d --build
docker compose ps
docker compose logs -f
```

## Architectural Conventions

1. **CamelCase API Boundary**: All JSON request and response payloads follow `camelCase`. The backend models inherit `CamelModel` (`backend/app/schemas/base.py`).
2. **Two-Phase Upload**: Large telemetry ZIPs stream directly to Google Drive via resumable upload sessions. The backend only stores catalog metadata in SQLite (`backend/data/cloud_logs.db`).
3. **No Cross-Pollution**: Keep Python code and dependencies inside `backend/` and Node code inside `frontend/`.
