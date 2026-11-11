import { describe, expect, it } from "vitest";
import type { Log } from "../../api/types";
import { csvFilename, toCsv } from "./exportCsv";

function makeSampleLog(overrides: Partial<Log> = {}): Log {
  return {
    id: "log-1",
    fileName: "run_2026.csv",
    status: "ready",
    fileSize: 1048576,
    tags: ["bms", "telemetry"],
    note: "Normal test run",
    creator: "engineer-1",
    startDate: "2026-03-12T10:00:00Z",
    endDate: "2026-03-12T10:30:00Z",
    createdAt: "2026-03-12T09:55:00Z",
    completedAt: "2026-03-12T10:31:00Z",
    driveFolder: "2026_03",
    driveUrl: "https://drive.google.com/file/d/123",
    driveFileId: "drive-123",
    fileHash: "abc123hash",
    clientMetadata: {},
    fileDate: null,
    createdBy: "user-1",
    ...overrides,
  };
}

describe("toCsv", () => {
  it("includes UTF-8 BOM and RFC 4180 CRLF line endings", () => {
    const csv = toCsv([]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("generates correct header columns in expected order", () => {
    const csv = toCsv([]);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    const headerLine = lines[0];

    const expectedHeaders = [
      '"id"',
      '"fileName"',
      '"status"',
      '"fileSize"',
      '"tags"',
      '"note"',
      '"creator"',
      '"startDate"',
      '"endDate"',
      '"createdAt"',
      '"completedAt"',
      '"driveFolder"',
      '"driveUrl"',
      '"fileHash"',
    ].join(",");

    expect(headerLine).toBe(expectedHeaders);
  });

  it("formats dates and handles missing/null dates gracefully", () => {
    const logWithDates = makeSampleLog({
      startDate: "2026-03-12T10:00:00Z",
      endDate: "2026-03-12T11:00:00Z",
      completedAt: "2026-03-12T11:05:00Z",
      createdAt: "2026-03-12T09:50:00Z",
    });

    const logWithoutDates = makeSampleLog({
      id: "log-2",
      startDate: null,
      endDate: null,
      completedAt: null,
      createdAt: "2026-03-12T09:50:00Z",
    });

    const csv = toCsv([logWithDates, logWithoutDates]);
    expect(csv).toContain('"2026-03-12T10:00:00Z"');
    expect(csv).toContain('"2026-03-12T11:00:00Z"');
    expect(csv).toContain('"2026-03-12T11:05:00Z"');

    // Missing dates are rendered as empty strings inside quotes `""`
    const rows = csv
      .replace(/^\uFEFF/, "")
      .split("\r\n")
      .filter(Boolean);
    const row2 = rows[2].split(",");
    // Column indices: startDate(7), endDate(8), completedAt(10)
    expect(row2[7]).toBe('""');
    expect(row2[8]).toBe('""');
    expect(row2[10]).toBe('""');
  });

  it("joins tags with single space and handles empty tags", () => {
    const log1 = makeSampleLog({ tags: ["bms", "vcu", "run-42"] });
    const log2 = makeSampleLog({ id: "log-2", tags: [] });

    const csv = toCsv([log1, log2]);
    expect(csv).toContain('"bms vcu run-42"');

    const rows = csv
      .replace(/^\uFEFF/, "")
      .split("\r\n")
      .filter(Boolean);
    const row2Cols = rows[2].split(",");
    // tags column index 4
    expect(row2Cols[4]).toBe('""');
  });

  it("escapes quotes according to RFC 4180 by doubling them", () => {
    const log = makeSampleLog({
      note: 'Note with "double quotes" and "more" quotes',
    });
    const csv = toCsv([log]);
    expect(csv).toContain('"Note with ""double quotes"" and ""more"" quotes"');
  });

  it("handles commas without corrupting cell boundaries", () => {
    const log = makeSampleLog({
      note: "Field, with, multiple, commas",
    });
    const csv = toCsv([log]);
    expect(csv).toContain('"Field, with, multiple, commas"');
  });

  it("preserves newlines inside quoted cells", () => {
    const log = makeSampleLog({
      note: "Line 1\nLine 2\r\nLine 3",
    });
    const csv = toCsv([log]);
    expect(csv).toContain('"Line 1\nLine 2\r\nLine 3"');
  });

  it("guards against CSV/formula injection (=, +, -, @)", () => {
    const dangerousLogs: Log[] = [
      makeSampleLog({ id: "log-eq", fileName: "=SUM(A1:A10)" }),
      makeSampleLog({ id: "log-plus", fileName: "+cmd|' /C calc'!A0" }),
      makeSampleLog({ id: "log-minus", fileName: "-2026_telemetry.csv" }),
      makeSampleLog({ id: "log-at", fileName: "@SUM(1+1)" }),
    ];

    const csv = toCsv(dangerousLogs);
    expect(csv).toContain('"\'=SUM(A1:A10)"');
    expect(csv).toContain("\"'+cmd|' /C calc'!A0\"");
    expect(csv).toContain('"\'-2026_telemetry.csv"');
    expect(csv).toContain('"\'@SUM(1+1)"');
  });

  it("handles null and empty optional fields", () => {
    const log = makeSampleLog({
      fileSize: null,
      note: null,
      driveFolder: null,
      driveUrl: null,
      fileHash: null,
    });
    const csv = toCsv([log]);
    const row = csv
      .replace(/^\uFEFF/, "")
      .split("\r\n")[1]
      .split(",");
    // fileSize is col 3, note is col 5, driveFolder is col 11, driveUrl is 12, fileHash is 13
    expect(row[3]).toBe('""');
    expect(row[5]).toBe('""');
    expect(row[11]).toBe('""');
    expect(row[12]).toBe('""');
    expect(row[13]).toBe('""');
  });
});

describe("csvFilename", () => {
  it("formats filename with prefix and current timestamp pattern", () => {
    const filename = csvFilename();
    expect(filename).toMatch(/^cloud-logs-\d{8}-\d{4}\.csv$/);
  });

  it("accepts custom prefix", () => {
    const filename = csvFilename("telemetry-export");
    expect(filename).toMatch(/^telemetry-export-\d{8}-\d{4}\.csv$/);
  });
});
