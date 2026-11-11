/**
 * Cliente HTTP del API Cloud Logs.
 *
 * Dos invariantes que importan con este backend:
 *
 * 1. El access token vive en memoria, nunca en localStorage. La sesión sobrevive a
 *    un recarga porque la cookie HttpOnly de refresh (path=/api/v1/auth) permite
 *    pedir uno nuevo al arrancar.
 * 2. El refresh es *single-flight*. El backend rota el refresh token en cada uso y
 *    trata el reuso de uno revocado como robo: revoca la familia entera y echa al
 *    usuario. Si dos peticiones caducan a la vez y cada una pide refresh, la segunda
 *    parece un reuso. Por eso todas comparten una única promesa de refresh.
 * 3. Hay un segundo modo de sesión: la **master key**. El backend la acepta en
 *    `Authorization: Bearer`, igual que un JWT, así que ocupa la misma ranura. Lo
 *    que cambia es que no caduca y no tiene refresh: ante un 401 no hay nada que
 *    renovar, y pedirlo cerraría la sesión por un fallo que no es de expiración.
 *    Por eso `masterMode` apaga las dos rutas de refresh.
 */

import type { TokenResponse } from "./types";

const BASE = "/api/v1";

/** Margen antes de la caducidad con el que ya pedimos un token nuevo. */
const EXPIRY_SKEW_MS = 30_000;

let accessToken: string | null = null;
let expiresAt = 0;
let refreshInFlight: Promise<string | null> | null = null;
let onUnauthenticated: (() => void) | null = null;
let masterMode = false;

/**
 * Dónde se guarda la master key para que aguante una recarga.
 *
 * `sessionStorage`, no `localStorage`: la clave da acceso total de administración
 * sin pasar por la tabla de usuarios, así que muere al cerrar la pestaña en vez de
 * quedarse en el disco. Sigue siendo una credencial completa en el navegador, y por
 * eso la pantalla de acceso lo dice.
 */
const MASTER_STORAGE_KEY = "cloud-logs-master-key";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export function setSession(token: string, expiresInSeconds: number): void {
  accessToken = token;
  expiresAt = Date.now() + expiresInSeconds * 1000;
}

export function clearSession(): void {
  accessToken = null;
  expiresAt = 0;
  masterMode = false;
  try {
    window.sessionStorage.removeItem(MASTER_STORAGE_KEY);
  } catch {
    // Sin almacenamiento no hay nada que limpiar.
  }
}

/** Entra en modo master key: la clave va donde iría el access token. */
export function setMasterSession(key: string): void {
  accessToken = key;
  // Sin caducidad: la clave no expira, así que nunca toca el refresh proactivo.
  expiresAt = Number.POSITIVE_INFINITY;
  masterMode = true;
  try {
    window.sessionStorage.setItem(MASTER_STORAGE_KEY, key);
  } catch {
    // Sin almacenamiento la sesión dura hasta la próxima recarga.
  }
}

/** La master key guardada en esta pestaña, si la hay. */
export function storedMasterKey(): string | null {
  try {
    return window.sessionStorage.getItem(MASTER_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function isMasterSession(): boolean {
  return masterMode;
}

export function hasSession(): boolean {
  return accessToken !== null;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string, expiresInSeconds = 900): void {
  setSession(token, expiresInSeconds);
}

export function clearAccessToken(): void {
  clearSession();
}

/** La capa de auth registra aquí su reacción a una sesión irrecuperable. */
export function setUnauthenticatedHandler(fn: (() => void) | null): void {
  onUnauthenticated = fn;
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204 || res.headers.get("content-length") === "0")
    return undefined;
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return res.json();
  return res.text();
}

/** El backend usa {detail} para HTTPException y {error, detail} para errores de validación. */
function messageFrom(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.detail === "string") return b.detail;
    if (typeof b.message === "string") return b.message;
    if (Array.isArray(b.detail)) {
      const first = b.detail[0] as
        { loc?: unknown[]; msg?: string } | undefined;
      if (first?.msg) {
        const field = Array.isArray(first.loc) ? first.loc.at(-1) : undefined;
        return field ? `${String(field)}: ${first.msg}` : first.msg;
      }
    }
    if (typeof b.error === "string") return b.error;
  }
  if (typeof body === "string" && body.trim()) return body;
  return `Error ${status}`;
}

/** Pide un access token nuevo con la cookie de refresh. Una sola a la vez. */
export function refreshSession(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        clearSession();
        onUnauthenticated?.();
        return null;
      }
      const data = (await res.json()) as TokenResponse;
      setSession(data.accessToken, data.expiresIn);
      return data.accessToken;
    } catch {
      // Un fallo de red transitorio (offline, caída temporal) no debe borrar la sesión ni expulsar al usuario.
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  /** Cuerpo JSON; se serializa y cabecera puesta automáticamente. */
  json?: unknown;
  /** Parámetros de query; se omiten los undefined/null/''. */
  query?: Record<string, unknown>;
  /** No intentar refresh ni reintento ante un 401 (para los propios endpoints de auth). */
  skipAuthRetry?: boolean;
  /** Clave maestra opcional enviada en la cabecera X-API-Key. */
  apiKey?: string;
}

function buildUrl(path: string, query?: Record<string, unknown>): string {
  const url = `${BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    json,
    query,
    skipAuthRetry = false,
    apiKey,
    headers,
    ...init
  } = options;

  // Refresh proactivo: evita el 401 cuando el token está a punto de caducar.
  if (
    !skipAuthRetry &&
    !masterMode &&
    accessToken &&
    Date.now() > expiresAt - EXPIRY_SKEW_MS
  ) {
    await refreshSession();
  }

  const send = (token: string | null): Promise<Response> =>
    fetch(buildUrl(path, query), {
      ...init,
      credentials: "include",
      headers: {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
        ...headers,
      },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });

  let res = await send(accessToken);

  // En modo master no hay refresh posible: un 401 significa que la clave ya no
  // vale, no que haya caducado un token.
  if (res.status === 401 && !skipAuthRetry && !masterMode) {
    const token = await refreshSession();
    if (token) res = await send(token);
  }

  const body = await parseBody(res);

  if (!res.ok) {
    if (res.status === 401) {
      clearSession();
      onUnauthenticated?.();
    }
    throw new ApiError(res.status, messageFrom(body, res.status), body);
  }

  return body as T;
}
