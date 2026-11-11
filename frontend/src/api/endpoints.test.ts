import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAccessToken, clearSession, setAccessToken } from "./client";
import {
  abortUpload,
  completeGithubLogin,
  completeUpload,
  deleteLog,
  downloadUrl,
  getGithubAuthUrl,
  getHealth,
  getLog,
  getMe,
  getStats,
  getTagsStats,
  initiateUpload,
  listTags,
  listUsers,
  logout,
  runCleanup,
  searchLogs,
  updateLog,
  updateUserRole,
  verifyMasterKey,
} from "./endpoints";
import { setupMockSessionStorage } from "./test-utils";

describe("downloadUrl", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  it("returns base download URL without query param when token is null", () => {
    expect(downloadUrl("log-123")).toBe("/api/v1/logs/log-123/download");
  });

  it("appends ?token=... when access token is present", () => {
    setAccessToken("test-jwt-token");
    expect(downloadUrl("log-123")).toBe(
      "/api/v1/logs/log-123/download?token=test-jwt-token",
    );
  });

  it("URI-encodes special characters in token parameter", () => {
    setAccessToken("abc/def+ghi== &foo=bar");
    expect(downloadUrl("log-special")).toBe(
      "/api/v1/logs/log-special/download?token=abc%2Fdef%2Bghi%3D%3D%20%26foo%3Dbar",
    );
  });
});

describe("endpoint URL generators and query parameter serialization", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setupMockSessionStorage();
    clearSession();

    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        return Response.json({ ok: true, url });
      });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearSession();
  });

  it("searchLogs serializes pagination, string filters, and array tags", async () => {
    await searchLogs({
      page: 2,
      pageSize: 50,
      textQuery: "motor test",
      status: "ready",
      tags: ["bms", "vcu"],
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/logs?page=2&pageSize=50&textQuery=motor+test&status=ready&tags=bms%2Cvcu",
      expect.anything(),
    );
  });

  it("searchLogs omits null, undefined, and empty string query parameters", async () => {
    await searchLogs({
      page: 1,
      textQuery: "",
      status: undefined,
      driveFolder: undefined,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/logs?page=1",
      expect.anything(),
    );
  });

  it("searchLogs defaults to /api/v1/logs when query is empty", async () => {
    await searchLogs();
    expect(fetchSpy).toHaveBeenCalledWith("/api/v1/logs", expect.anything());
  });

  it("getLog calls /api/v1/logs/:id", async () => {
    await getLog("uuid-456");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/logs/uuid-456",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("listTags calls /api/v1/logs/tags", async () => {
    await listTags();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/logs/tags",
      expect.anything(),
    );
  });

  it("getTagsStats calls /api/v1/logs/tags/stats", async () => {
    await getTagsStats();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/logs/tags/stats",
      expect.anything(),
    );
  });

  it("getStats calls /api/v1/logs/stats", async () => {
    await getStats();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/logs/stats",
      expect.anything(),
    );
  });

  it("initiateUpload posts JSON payload to /api/v1/logs/initiate", async () => {
    const payload = {
      fileName: "test.csv",
      fileSize: 2048,
      tags: ["telemetry"],
      note: "Sample upload",
    };
    await initiateUpload(payload);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/logs/initiate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("completeUpload posts to /api/v1/logs/:id/complete", async () => {
    await completeUpload("log-789", { fileHash: "hash-xyz" });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/logs/log-789/complete",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ fileHash: "hash-xyz" }),
      }),
    );
  });

  it("abortUpload posts reason to /api/v1/logs/:id/abort", async () => {
    await abortUpload("log-789", "Cancelled by user");

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/logs/log-789/abort",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "Cancelled by user" }),
      }),
    );
  });

  it("updateLog sends PATCH with JSON body", async () => {
    await updateLog("log-789", { note: "Edited note" });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/logs/log-789",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ note: "Edited note" }),
      }),
    );
  });

  it("deleteLog sends DELETE to /api/v1/logs/:id", async () => {
    await deleteLog("log-789");

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/logs/log-789",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });

  it("runCleanup serializes boolean and numeric query options", async () => {
    await runCleanup({
      retentionDays: 30,
      dryRun: true,
      purgeSoftDeleted: false,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/logs/cleanup?retentionDays=30&dryRun=true&purgeSoftDeleted=false",
      expect.anything(),
    );
  });

  it("listUsers calls /api/v1/users", async () => {
    await listUsers();
    expect(fetchSpy).toHaveBeenCalledWith("/api/v1/users", expect.anything());
  });

  it("updateUserRole sends PATCH with role payload to /api/v1/users/:id/role", async () => {
    await updateUserRole("user-1", "admin");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/users/user-1/role",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ role: "admin" }),
      }),
    );
  });

  it("getGithubAuthUrl returns authorization URL", async () => {
    fetchSpy.mockResolvedValueOnce(
      Response.json({
        authorizationUrl: "https://github.com/login/oauth/authorize?state=xyz",
      }),
    );

    const authUrl = await getGithubAuthUrl();
    expect(authUrl).toBe("https://github.com/login/oauth/authorize?state=xyz");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/auth/login",
      expect.anything(),
    );
  });

  it("completeGithubLogin passes code and state query params", async () => {
    fetchSpy.mockResolvedValueOnce(
      Response.json({
        accessToken: "new-access-token",
        tokenType: "bearer",
        expiresIn: 900,
        refreshToken: null,
        user: null,
      }),
    );

    await completeGithubLogin("code-abc", "state-def");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/auth/callback?code=code-abc&state=state-def",
      expect.anything(),
    );
  });

  it("logout sends POST to /api/v1/auth/logout", async () => {
    await logout();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("verifyMasterKey sends Authorization Bearer with skipAuthRetry", async () => {
    await verifyMasterKey("master-secret-key");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/users?pageSize=1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer master-secret-key",
        }),
      }),
    );
  });

  it("getMe calls /api/v1/auth/me", async () => {
    await getMe();
    expect(fetchSpy).toHaveBeenCalledWith("/api/v1/auth/me", expect.anything());
  });

  it("getHealth returns body when status is 503 with JSON payload", async () => {
    const degradedHealth = {
      status: "degraded",
      services: { database: "healthy", drive: "down" },
    };
    fetchSpy.mockResolvedValueOnce(
      Response.json(degradedHealth, { status: 503 }),
    );

    const result = await getHealth();
    expect(result).toEqual(degradedHealth);
  });

  it("getHealth rethrows non-503 HTTP errors", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("Internal Server Error", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    await expect(getHealth()).rejects.toThrow("Internal Server Error");
  });
});
