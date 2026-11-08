/** Endpoints del API, uno por operación. Sin estado: la sesión la gestiona client.ts. */

import { request, setSession } from "./client";
import type {
  CleanupResult,
  GitHubAuthUrl,
  Health,
  Log,
  LogAbortResponse,
  LogCompleteResponse,
  LogInitiateRequest,
  LogInitiateResponse,
  LogPage,
  LogQuery,
  LogStats,
  LogUpdateRequest,
  Role,
  TokenResponse,
  User,
} from "./types";

/* ---------- auth ---------- */

/**
 * Paso 1 del login: el backend genera el state, lo deja en una cookie y devuelve
 * la URL de GitHub. Devolvemos la URL para que el llamante haga la navegación.
 *
 * GITHUB_REDIRECT_URI del backend debe apuntar a ESTE front (p. ej.
 * http://localhost:5173/auth/callback), no al propio backend, o el navegador
 * aterrizará en un JSON en vez de volver a la app.
 */
export async function getGithubAuthUrl(): Promise<string> {
  const data = await request<GitHubAuthUrl>("/auth/login", {
    skipAuthRetry: true,
  });
  return data.authorizationUrl;
}

/** Paso 2: canjea el code por tokens. Valida el state contra la cookie oauth_state. */
export async function completeGithubLogin(
  code: string,
  state: string,
): Promise<TokenResponse> {
  const data = await request<TokenResponse>("/auth/callback", {
    query: { code, state },
    skipAuthRetry: true,
  });
  setSession(data.accessToken, data.expiresIn);
  return data;
}

export function logout(): Promise<unknown> {
  return request("/auth/logout", { method: "POST", skipAuthRetry: true });
}

/**
 * Comprueba una master key preguntando por el listado de usuarios.
 *
 * No se usa `/users/me`: con master key el backend responde 401 ("User profile not
 * available for system callers"), porque no hay fila de usuario detrás. `/users` es
 * de solo-admin, así que un 200 confirma a la vez que la clave vale y que da nivel
 * de administración.
 */
export async function verifyMasterKey(key: string): Promise<void> {
  await request<User[]>("/users", {
    query: { pageSize: 1 },
    headers: { Authorization: `Bearer ${key}` },
    skipAuthRetry: true,
  });
}

export function getMe(): Promise<User> {
  return request<User>("/auth/me");
}

export function getHealth(): Promise<Health> {
  return request<Health>("/health", { skipAuthRetry: true });
}

/* ---------- logs ---------- */

export function searchLogs(query: LogQuery = {}): Promise<LogPage> {
  return request<LogPage>("/logs", { query: query as Record<string, unknown> });
}

export function getLog(id: string): Promise<Log> {
  return request<Log>(`/logs/${id}`);
}

export function listTags(): Promise<string[]> {
  return request<string[]>("/logs/tags");
}

export function getStats(): Promise<LogStats> {
  return request<LogStats>("/logs/stats");
}

export function initiateUpload(
  payload: LogInitiateRequest,
): Promise<LogInitiateResponse> {
  return request<LogInitiateResponse>("/logs/initiate", {
    method: "POST",
    json: payload,
  });
}

export function completeUpload(
  id: string,
  payload: { fileHash?: string | null; driveFileId?: string | null } = {},
): Promise<LogCompleteResponse> {
  return request<LogCompleteResponse>(`/logs/${id}/complete`, {
    method: "POST",
    json: payload,
  });
}

export function abortUpload(
  id: string,
  reason?: string,
): Promise<LogAbortResponse> {
  return request<LogAbortResponse>(`/logs/${id}/abort`, {
    method: "POST",
    json: { reason: reason ?? null },
  });
}

export function updateLog(id: string, payload: LogUpdateRequest): Promise<Log> {
  return request<Log>(`/logs/${id}`, { method: "PATCH", json: payload });
}

export function deleteLog(id: string): Promise<void> {
  return request<void>(`/logs/${id}`, { method: "DELETE" });
}

/** La descarga es un 307 a Google Drive: hay que navegar, no hacer fetch (CORS). */
export function downloadUrl(id: string): string {
  return `/api/v1/logs/${id}/download`;
}

/* ---------- admin ---------- */

export function listUsers(): Promise<User[]> {
  return request<User[]>("/users");
}

export function updateUserRole(id: string, role: Role): Promise<User> {
  return request<User>(`/users/${id}/role`, {
    method: "PATCH",
    json: { role },
  });
}

export function runCleanup(
  opts: {
    retentionDays?: number;
    dryRun?: boolean;
    purgeSoftDeleted?: boolean;
  } = {},
): Promise<CleanupResult> {
  return request<CleanupResult>("/logs/cleanup", {
    method: "POST",
    query: opts,
  });
}
