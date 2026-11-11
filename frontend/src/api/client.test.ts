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
import { setupMockSessionStorage } from "./test-utils";

describe("access token getters and setters", () => {
  beforeEach(() => {
    setupMockSessionStorage();
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
    setupMockSessionStorage();
    clearSession();

    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return Response.json({ status: "ok" });
    });
  });

  afterEach(() => {
    clearSession();
    vi.restoreAllMocks();
  });

  it("makes public requests without Authorization or X-API-Key headers", async () => {
    await request("/health", { skipAuthRetry: true });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/health",
      expect.objectContaining({
        headers: {},
      }),
    );
  });

  it("injects Bearer token header when access token is present", async () => {
    setAccessToken("user-jwt-bearer-token");

    await request("/logs", { skipAuthRetry: true });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/logs",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer user-jwt-bearer-token",
        }),
      }),
    );
  });

  it("injects X-API-Key header when apiKey option is provided", async () => {
    await request("/logs", {
      apiKey: "system-master-api-key",
      skipAuthRetry: true,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/logs",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-API-Key": "system-master-api-key",
        }),
      }),
    );
  });

  it("injects X-API-Key header when passed via custom headers", async () => {
    await request("/logs", {
      headers: { "X-API-Key": "direct-master-key" },
      skipAuthRetry: true,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/logs",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-API-Key": "direct-master-key",
        }),
      }),
    );
  });

  it("injects Content-Type: application/json when json body is specified", async () => {
    const payload = { action: "sync", count: 42 };
    await request("/test", {
      method: "POST",
      json: payload,
      skipAuthRetry: true,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/test",
      expect.objectContaining({
        body: JSON.stringify(payload),
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("merges custom headers with default headers", async () => {
    setAccessToken("token-xyz");
    await request("/test", {
      headers: { "X-Custom-Client": "hyperloop-ui" },
      skipAuthRetry: true,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/test",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-xyz",
          "X-Custom-Client": "hyperloop-ui",
        }),
      }),
    );
  });
});

describe("HTTP error response handling", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let unauthSpy: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    setupMockSessionStorage();
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
      Response.json({ detail: "Token expired or invalid" }, { status: 401 }),
    );

    await expect(
      request("/users/me", { skipAuthRetry: true }),
    ).rejects.toMatchObject({
      status: 401,
      message: "Token expired or invalid",
    });

    expect(getAccessToken()).toBeNull();
    expect(hasSession()).toBe(false);
    expect(unauthSpy).toHaveBeenCalledTimes(1);
  });

  it("retries 401 when refreshSession succeeds", async () => {
    setAccessToken("about-to-expire");

    fetchSpy
      .mockResolvedValueOnce(
        Response.json({ detail: "Signature has expired" }, { status: 401 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          accessToken: "refreshed-new-token",
          expiresIn: 900,
        }),
      )
      .mockResolvedValueOnce(Response.json({ data: "success after refresh" }));

    const result = await request<{ data: string }>("/logs");
    expect(result).toEqual({ data: "success after refresh" });
    expect(getAccessToken()).toBe("refreshed-new-token");
    expect(unauthSpy).not.toHaveBeenCalled();
  });

  it("clears session if 401 refresh fails", async () => {
    setAccessToken("revoked-token");

    fetchSpy.mockResolvedValueOnce(
      Response.json({ detail: "Unauthorized" }, { status: 401 }),
    );
    fetchSpy.mockResolvedValueOnce(
      Response.json({ detail: "Refresh token revoked" }, { status: 401 }),
    );

    await expect(request("/logs")).rejects.toThrow(ApiError);
    expect(getAccessToken()).toBeNull();
    expect(unauthSpy).toHaveBeenCalled();
  });

  it("handles 403 Forbidden without clearing session", async () => {
    setAccessToken("regular-user-token");

    fetchSpy.mockResolvedValueOnce(
      Response.json(
        { detail: "You do not have permission to delete this log" },
        { status: 403 },
      ),
    );

    await expect(
      request("/logs/log-1", { method: "DELETE" }),
    ).rejects.toMatchObject({
      status: 403,
      message: "You do not have permission to delete this log",
    });

    expect(getAccessToken()).toBe("regular-user-token");
    expect(unauthSpy).not.toHaveBeenCalled();
  });

  it("handles 404 Not Found", async () => {
    fetchSpy.mockResolvedValueOnce(
      Response.json({ detail: "Log not found" }, { status: 404 }),
    );

    await expect(request("/logs/missing-id")).rejects.toThrow("Log not found");
  });

  it("handles 503 Service Unavailable and preserves body", async () => {
    const errorBody = {
      error: "Google Drive service temporarily unavailable",
      retryAfter: 30,
    };
    fetchSpy.mockResolvedValueOnce(Response.json(errorBody, { status: 503 }));

    await expect(
      request("/logs/upload", { skipAuthRetry: true }),
    ).rejects.toMatchObject({
      status: 503,
      message: "Google Drive service temporarily unavailable",
      body: errorBody,
    });
  });

  it("formats Pydantic 422 validation errors with field name", async () => {
    fetchSpy.mockResolvedValueOnce(
      Response.json(
        {
          detail: [
            {
              loc: ["body", "fileSize"],
              msg: "Input should be greater than 0",
            },
          ],
        },
        { status: 422 },
      ),
    );

    await expect(
      request("/logs/initiate", { method: "POST", json: {} }),
    ).rejects.toMatchObject({
      status: 422,
      message: "fileSize: Input should be greater than 0",
    });
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

    await expect(
      request("/crash", { skipAuthRetry: true }),
    ).rejects.toMatchObject({
      status: 500,
      message: "Error 500",
    });
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
