import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  clearAccessToken,
  clearSession,
  getAccessToken,
  hasSession,
  isMasterSession,
  request,
  setAccessToken,
  setMasterSession,
  setSession,
  setUnauthenticatedHandler,
  storedMasterKey,
} from "./client";

describe("access token getters and setters", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    const mockSessionStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => storage.set(key, String(val)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    };
    vi.stubGlobal("window", { sessionStorage: mockSessionStorage });
    clearSession();
  });

  afterEach(() => {
    clearSession();
    vi.restoreAllMocks();
  });

  it("getAccessToken returns null by default and hasSession is false", () => {
    expect(getAccessToken()).toBeNull();
    expect(hasSession()).toBe(false);
  });

  it("setAccessToken stores access token and hasSession returns true", () => {
    setAccessToken("jwt-access-token-123");
    expect(getAccessToken()).toBe("jwt-access-token-123");
    expect(hasSession()).toBe(true);
  });

  it("clearAccessToken removes access token and resets session", () => {
    setAccessToken("jwt-access-token-123");
    expect(getAccessToken()).toBe("jwt-access-token-123");

    clearAccessToken();
    expect(getAccessToken()).toBeNull();
    expect(hasSession()).toBe(false);
  });

  it("setSession and clearSession manage token and session lifecycle", () => {
    setSession("session-token-456", 1800);
    expect(getAccessToken()).toBe("session-token-456");
    expect(hasSession()).toBe(true);

    clearSession();
    expect(getAccessToken()).toBeNull();
    expect(hasSession()).toBe(false);
  });

  it("setMasterSession stores master key in memory and sessionStorage", () => {
    setMasterSession("master-secret-key");
    expect(getAccessToken()).toBe("master-secret-key");
    expect(hasSession()).toBe(true);
    expect(isMasterSession()).toBe(true);
    expect(storedMasterKey()).toBe("master-secret-key");

    clearSession();
    expect(getAccessToken()).toBeNull();
    expect(isMasterSession()).toBe(false);
    expect(storedMasterKey()).toBeNull();
  });
});

describe("request header injection", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const storage = new Map<string, string>();
    const mockSessionStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => storage.set(key, String(val)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    };
    vi.stubGlobal("window", { sessionStorage: mockSessionStorage });
    clearSession();

    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  });

  afterEach(() => {
    clearSession();
    vi.restoreAllMocks();
  });

  it("makes public requests without Authorization or X-API-Key headers", async () => {
    await request("/health", { skipAuthRetry: true });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callInit = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = (callInit.headers ?? {}) as Record<string, string>;

    expect(headers.Authorization).toBeUndefined();
    expect(headers["X-API-Key"]).toBeUndefined();
  });

  it("injects Bearer token header when access token is present", async () => {
    setAccessToken("user-jwt-bearer-token");

    await request("/logs", { skipAuthRetry: true });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callInit = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = (callInit.headers ?? {}) as Record<string, string>;

    expect(headers.Authorization).toBe("Bearer user-jwt-bearer-token");
    expect(headers["X-API-Key"]).toBeUndefined();
  });

  it("injects X-API-Key header when apiKey option is provided", async () => {
    await request("/logs", {
      apiKey: "system-master-api-key",
      skipAuthRetry: true,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callInit = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = (callInit.headers ?? {}) as Record<string, string>;

    expect(headers["X-API-Key"]).toBe("system-master-api-key");
    expect(headers.Authorization).toBeUndefined();
  });

  it("injects X-API-Key header when passed via custom headers", async () => {
    await request("/logs", {
      headers: { "X-API-Key": "direct-master-key" },
      skipAuthRetry: true,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callInit = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = (callInit.headers ?? {}) as Record<string, string>;

    expect(headers["X-API-Key"]).toBe("direct-master-key");
  });

  it("injects Content-Type: application/json when json body is specified", async () => {
    const payload = { action: "sync", count: 42 };
    await request("/test", {
      method: "POST",
      json: payload,
      skipAuthRetry: true,
    });

    const callInit = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = (callInit.headers ?? {}) as Record<string, string>;

    expect(headers["Content-Type"]).toBe("application/json");
    expect(callInit.body).toBe(JSON.stringify(payload));
  });

  it("merges custom headers with default headers", async () => {
    setAccessToken("token-xyz");
    await request("/test", {
      headers: { "X-Custom-Client": "hyperloop-ui" },
      skipAuthRetry: true,
    });

    const callInit = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = (callInit.headers ?? {}) as Record<string, string>;

    expect(headers.Authorization).toBe("Bearer token-xyz");
    expect(headers["X-Custom-Client"]).toBe("hyperloop-ui");
  });
});

describe("HTTP error response handling", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let unauthSpy: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    const storage = new Map<string, string>();
    const mockSessionStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => storage.set(key, String(val)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    };
    vi.stubGlobal("window", { sessionStorage: mockSessionStorage });
    clearSession();

    unauthSpy = vi.fn<() => void>();
    setUnauthenticatedHandler(unauthSpy);

    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    clearSession();
    setUnauthenticatedHandler(null);
    vi.restoreAllMocks();
  });

  it("handles 401 error: clears session, triggers unauthenticated callback, and throws ApiError", async () => {
    setAccessToken("expired-token");

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Token expired or invalid" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    let thrownError: unknown;
    try {
      await request("/users/me", { skipAuthRetry: true });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(ApiError);
    const apiErr = thrownError as ApiError;
    expect(apiErr.status).toBe(401);
    expect(apiErr.message).toBe("Token expired or invalid");
    expect(getAccessToken()).toBeNull();
    expect(hasSession()).toBe(false);
    expect(unauthSpy).toHaveBeenCalledTimes(1);
  });

  it("retries 401 when refreshSession succeeds", async () => {
    setAccessToken("about-to-expire");

    // First call to endpoint returns 401
    // Second call is refresh (/api/v1/auth/refresh) returning new token
    // Third call is retried request with new token
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Signature has expired" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: "refreshed-new-token",
            expiresIn: 900,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: "success after refresh" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const result = await request<{ data: string }>("/logs");
    expect(result).toEqual({ data: "success after refresh" });
    expect(getAccessToken()).toBe("refreshed-new-token");
    expect(unauthSpy).not.toHaveBeenCalled();
  });

  it("clears session if 401 refresh fails", async () => {
    setAccessToken("revoked-token");

    // Initial request fails with 401
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // Refresh also fails with 401
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Refresh token revoked" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(request("/logs")).rejects.toThrow(ApiError);
    expect(getAccessToken()).toBeNull();
    expect(unauthSpy).toHaveBeenCalled();
  });

  it("handles 403 Forbidden without clearing session", async () => {
    setAccessToken("regular-user-token");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: "You do not have permission to delete this log",
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
    );

    let thrownError: unknown;
    try {
      await request("/logs/log-1", { method: "DELETE" });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(ApiError);
    const apiErr = thrownError as ApiError;
    expect(apiErr.status).toBe(403);
    expect(apiErr.message).toBe(
      "You do not have permission to delete this log",
    );
    // Session is preserved
    expect(getAccessToken()).toBe("regular-user-token");
    expect(unauthSpy).not.toHaveBeenCalled();
  });

  it("handles 404 Not Found", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Log not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(request("/logs/missing-id")).rejects.toThrow("Log not found");
  });

  it("handles 503 Service Unavailable and preserves body", async () => {
    const errorBody = {
      error: "Google Drive service temporarily unavailable",
      retryAfter: 30,
    };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(errorBody), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );

    let thrownError: unknown;
    try {
      await request("/logs/upload", { skipAuthRetry: true });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(ApiError);
    const apiErr = thrownError as ApiError;
    expect(apiErr.status).toBe(503);
    expect(apiErr.message).toBe("Google Drive service temporarily unavailable");
    expect(apiErr.body).toEqual(errorBody);
  });

  it("formats Pydantic 422 validation errors with field name", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: [
            {
              loc: ["body", "fileSize"],
              msg: "Input should be greater than 0",
            },
          ],
        }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      ),
    );

    let thrownError: unknown;
    try {
      await request("/logs/initiate", { method: "POST", json: {} });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(ApiError);
    const apiErr = thrownError as ApiError;
    expect(apiErr.status).toBe(422);
    expect(apiErr.message).toBe("fileSize: Input should be greater than 0");
  });

  it("handles plain text error response", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("Bad Gateway: upstream failed", {
        status: 502,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    await expect(request("/status", { skipAuthRetry: true })).rejects.toThrow(
      "Bad Gateway: upstream failed",
    );
  });

  it("falls back to generic error message when body is empty", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    let thrownError: unknown;
    try {
      await request("/crash", { skipAuthRetry: true });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(ApiError);
    const apiErr = thrownError as ApiError;
    expect(apiErr.status).toBe(500);
    expect(apiErr.message).toBe("Error 500");
  });

  it("returns undefined for 204 No Content responses", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 204,
      }),
    );

    const result = await request("/logs/123", {
      method: "DELETE",
      skipAuthRetry: true,
    });
    expect(result).toBeUndefined();
  });
});
