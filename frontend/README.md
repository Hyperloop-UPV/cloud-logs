# Cloud Logs — frontend

Web interface for the Cloud Logs catalog: the telemetry and diagnostic archives
of the Hyperloop UPV pod. A single-page app that talks to the FastAPI service in
this repository and adds nothing of its own — there is no frontend server, no
database and no session state beyond the browser.

Part of the `cloud-logs` monorepo architecture (`frontend/` for the web UI and
`backend/` for the FastAPI service).

React 19 · Vite · TypeScript · Tailwind v4 through
[`@hyperloopupv/frontend-kit`](https://github.com/Hyperloop-UPV) · TanStack Query ·
React Router 7.

---

## Getting started

The frontend needs the API running: on its own it has nothing to show.

In the monorepo architecture, the backend is located in `backend/` and the frontend in `frontend/`.

```bash
# 1. The backend, located in backend/
cd backend
source ../.venv/bin/activate
uvicorn app.main:app --reload --port 8000

# 2. The frontend, from frontend/
cd ../frontend
npm install
npm run dev            # http://localhost:5173
```

### Pointing at another backend

The dev server proxies `/api` to `http://localhost:8000` unless you say
otherwise:

```bash
VITE_API_TARGET=http://127.0.0.1:8001 npm run dev
```

> `VITE_API_TARGET` is read from the **shell environment**, not from a `.env`
> file. `vite.config.ts` reads `process.env` directly, and Vite does not load
> `.env` into `process.env` by itself. Putting it in a `.env` file will silently
> do nothing.

### Why a proxy and not CORS

In development the API is served from the same origin as the app. That is
deliberate: the refresh token travels in a cookie scoped to `/api/v1/auth`, and
same-origin means it is sent without fighting CORS or `SameSite`.

---

## Signing in locally

Two ways in, and for day-to-day development the second is far less trouble.

**GitHub OAuth** is the real path. It needs `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET` and `GITHUB_REDIRECT_URI` configured in the backend's
`.env` (`backend/.env`) and in the GitHub OAuth App, and your account must belong to the
organisation named in `GITHUB_ORG_NAME`.

> **The redirect URI points at the app, not at the API.** This SPA handles the
> callback itself:
>
> ```
> GITHUB_REDIRECT_URI=http://localhost:5173/auth/callback
> ```
>
> Point it at the backend and the browser lands on a JSON response instead of
> coming back to the app.

**The master key** is the service door. Choose *Use a master key instead* on the
sign-in screen and paste the backend's `MASTER_API_KEY`. It grants full
administrator access with no user account behind it, so some screens behave
slightly differently — `/about` and the team page expect a real user row.

> The master key is held in `sessionStorage`, for the current tab only, and is
> forgotten when you close it. It is never written to `localStorage`, and it must
> stay that way.

Without Google credentials the backend needs `GDRIVE_SIMULATION_MODE=true`, or
every upload call returns 503. Uploads then complete against fabricated Drive
URLs, which is enough to exercise the whole flow.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 5173, with the `/api` proxy |
| `npm run build` | Type-checks (`tsc -b`) and builds into `dist/` |
| `npm run preview` | Serves the built `dist/` locally |
| `npm run lint` | Oxlint over the project |
| `npx prettier --write src` | Formats, sorting Tailwind classes |
| `npx tsc --noEmit -p tsconfig.app.json` | Type-check alone, faster than a build |

The last two have no npm script of their own. `npm run build` type-checks
anyway, so a clean build is the real gate.

---

## Where things live

```
src/
  api/         Fetch client, typed endpoints, shared types
  auth/        Session context: OAuth, refresh, master key
  components/
    brand/     Team and Software marks
    data/      Table primitives shared by the catalog
    layout/    Shell, sidebar, page header
  constants/   Chart configuration, the page/route map
  features/    One folder per screen
  hooks/       Cross-cutting hooks (colour scheme)
  lib/         Formatting helpers
  routes/      Sign-in, OAuth callback, route guard
```

| Route | Screen |
| --- | --- |
| `/` | Dashboard — totals, uploads per month, status, recent activity |
| `/catalog` | Search, filters, saved views, bulk tagging, CSV export, detail panel |
| `/tags` | Tag collections, as cards or a sortable table |
| `/graph` | Force graph: one node per log, one per tag |
| `/upload` | Two-phase upload, straight to Drive |
| `/team` | Users and cleanup (admin only) |
| `/about` | Credits and service status |
| `/signin` | GitHub OAuth and master key |

Only the catalog ships in the main bundle, because it is the screen used daily.
The rest load on visit — the dashboard pulls in uPlot and the graph pulls in
`react-force-graph`, which is the heaviest dependency here at roughly 210 kB on
its own.

---

## Conventions worth knowing before changing anything

- **The URL is the source of truth.** Filters, sorting, pagination, the open
  log and the view mode all live in the query string, so any view can be shared
  by link and survives a reload.
- **Saturated colour means status.** Green, amber, red and grey are reserved for
  the four log states and come from a single map (`features/catalog/statusStyles.ts`).
  Brand orange is for the brand and the primary action, nothing else.
- **The component kit comes first.** Reach for `@hyperloopupv/frontend-kit`
  before writing a component, and take missing icons from `lucide-react`. Do not
  add `@radix-ui/*` directly — the kit owns that.
- **Canvas inherits no CSS.** Anything drawn on a canvas reads its colours from
  the CSS variables through `readThemeColors()`, and follows theme changes with a
  `MutationObserver` on `documentElement` rather than a prop.

`CLAUDE.md`, next to this file, holds the longer list: the traps found the hard
way, with the reason each rule exists. Worth reading before a non-trivial change.

---

## What the API does and does not give you

[`docs/API_FRONTEND.md`](../docs/API_FRONTEND.md) is the endpoint reference —
camelCase payloads, query parameters and examples. Two consequences shape this
app and are not obvious from the screens:

- **Tag statistics are aggregated on the server via `GET /api/v1/logs/tags/stats`.**
  Previously the API did not aggregate tags and the client had to paginate up to 20
  pages of `/logs`. Now `GET /api/v1/logs/tags/stats` is available and consumed by
  `useTagAggregate.ts`, providing exact totals (bytes, dates, status breakdown, and
  co-occurrences). The hook only paginates `/logs` (up to 2,000 logs) to supply
  individual nodes for the interactive graph in `/graph`.
- **Deletion is soft and cannot be undone from here.** `DELETE /logs/{id}` sets
  `deleted_at`; the row stays in SQLite and the archive in Drive is untouched. No
  endpoint can read or restore a deleted log, so there is no trash screen. That
  would need `POST /logs/{id}/restore` and an `includeDeleted` filter.

---

## Deployment

`npm run build` emits a static bundle into `dist/`, roughly 1 MB in total. It is
already split by route: only the catalog ships in the main chunk, and the
dashboard (uPlot) and the graph (`react-force-graph`, ~210 kB) download when
someone visits them.

```bash
nvm use                 # Node 24, as pinned in .nvmrc
npm ci
npm run check           # format, lint and build — what has to pass before shipping
```

### It must be served from the same origin as the API

This is not a preference. `src/api/client.ts` calls `/api/v1/...` as a relative
path, and the refresh token lives in an `HttpOnly` cookie scoped to
`/api/v1/auth`. Serve the app from a different origin and the cookie stops
travelling, which means every reload throws the user back to sign-in. There is
deliberately no `VITE_API_BASE_URL`: it would make a broken setup easy to
configure.

Everything in `dist/index.html` is referenced from the root (`/assets/…`,
`/favicon.svg`), so the app has to be served at the domain root, not under a
subpath. Serving it elsewhere needs `base` in `vite.config.ts`.

### Serving it from FastAPI

The chosen option. **This is a backend change and is not applied here** — the
frontend is ready for it; the snippet below is for whoever owns `backend/app/`.

It goes at the very end of `backend/app/main.py`, after
`app.include_router(api_router, prefix="/api/v1")`. Order matters: routes
declared earlier win, so the catch-all cannot swallow `/api/v1/*`, `/docs`,
`/redoc`, `/openapi.json` or `/health`.

```python
from pathlib import Path

from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

if FRONTEND_DIST.is_dir():
    # Hashed filenames, so they can be cached hard.
    app.mount(
        "/assets",
        StaticFiles(directory=FRONTEND_DIST / "assets"),
        name="assets",
    )

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str) -> FileResponse:
        """Serve index.html for client-side routes (/catalog, /graph, …)."""
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
```

Three things to decide while applying it:

- **`GET /` is already taken** by the service-identity endpoint
  (`backend/app/main.py:128`), and a declared route wins over the catch-all. Visiting the
  domain root would return that JSON instead of the app. Either remove it, or
  move it to something like `/api`.
- **`index.html` must not be cached**, or people keep running an old build after
  a deploy. The files under `/assets` carry a content hash in the name and can be
  cached forever. The snippet sets no cache headers; add them where the reverse
  proxy lives.
- **The container only copies `backend/` (or `backend/app/`).** The `backend/Dockerfile` would need the
  built `dist/` inside the image, either by building the frontend in an earlier
  stage or by copying a prebuilt `dist/`.

### GitHub OAuth in production

The redirect URI points at the app, which once FastAPI serves it is the same
origin as the API:

```
GITHUB_REDIRECT_URI=https://<host>/auth/callback
```

That path has to reach the SPA fallback. It is a client-side route — there is no
`/auth/callback` endpoint in the API.
