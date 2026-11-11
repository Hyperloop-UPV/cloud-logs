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

function parseCsv(csv: string): string[][] {
  const text = csv.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentCell += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        currentRow.push(currentCell);
        currentCell = "";
      } else if (char === "\r" && nextChar === "\n") {
        currentRow.push(currentCell);
        rows.push(currentRow);
        currentRow = [];
        currentCell = "";
        i++;
      } else if (char === "\n") {
        currentRow.push(currentCell);
        rows.push(currentRow);
        currentRow = [];
        currentCell = "";
      } else {
        currentCell += char;
      }
    }
  }

  if (currentRow.length > 0 || currentCell.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows;
}

function parseCsvRows(csv: string): Record<string, string>[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? "";
    });
    return record;
  });
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

    const [row1, row2] = parseCsvRows(toCsv([logWithDates, logWithoutDates]));

    expect(row1.startDate).toBe("2026-03-12T10:00:00Z");
    expect(row1.endDate).toBe("2026-03-12T11:00:00Z");
    expect(row1.completedAt).toBe("2026-03-12T11:05:00Z");
    expect(row1.createdAt).toBe("2026-03-12T09:50:00Z");

    expect(row2.startDate).toBe("");
    expect(row2.endDate).toBe("");
    expect(row2.completedAt).toBe("");
  });

  it("joins tags with single space and handles empty tags", () => {
    const log1 = makeSampleLog({ tags: ["bms", "vcu", "run-42"] });
    const log2 = makeSampleLog({ id: "log-2", tags: [] });

    const [row1, row2] = parseCsvRows(toCsv([log1, log2]));
    expect(row1.tags).toBe("bms vcu run-42");
    expect(row2.tags).toBe("");
  });

  it("escapes quotes according to RFC 4180 by doubling them", () => {
    const log = makeSampleLog({
      note: 'Note with "double quotes" and "more" quotes',
    });
    const csv = toCsv([log]);
    expect(csv).toContain('"Note with ""double quotes"" and ""more"" quotes"');

    const [row] = parseCsvRows(csv);
    expect(row.note).toBe('Note with "double quotes" and "more" quotes');
  });

  it("handles commas without corrupting cell boundaries", () => {
    const log = makeSampleLog({
      note: "Field, with, multiple, commas",
    });
    const [row] = parseCsvRows(toCsv([log]));
    expect(row.note).toBe("Field, with, multiple, commas");
  });

  it("preserves newlines inside quoted cells", () => {
    const log = makeSampleLog({
      note: "Line 1\nLine 2\r\nLine 3",
    });
    const [row] = parseCsvRows(toCsv([log]));
    expect(row.note).toBe("Line 1\nLine 2\r\nLine 3");
  });

  it.each([
    ["=", "=SUM(A1:A10)", "'=SUM(A1:A10)"],
    ["+", "+cmd|' /C calc'!A0", "'+cmd|' /C calc'!A0"],
    ["-", "-2026_telemetry.csv", "'-2026_telemetry.csv"],
    ["@", "@SUM(1+1)", "'@SUM(1+1)"],
  ])(
    "guards against CSV/formula injection for %s prefix",
    (_prefix, fileName, expected) => {
      const log = makeSampleLog({ fileName });
      const csv = toCsv([log]);
      const [row] = parseCsvRows(csv);
      expect(row.fileName).toBe(expected);
      expect(csv).toContain(`"${expected}"`);
    },
  );

  it("handles null and empty optional fields", () => {
    const log = makeSampleLog({
      fileSize: null,
      note: null,
      driveFolder: null,
      driveUrl: null,
      fileHash: null,
    });
    const [row] = parseCsvRows(toCsv([log]));
    expect(row.fileSize).toBe("");
    expect(row.note).toBe("");
    expect(row.driveFolder).toBe("");
    expect(row.driveUrl).toBe("");
    expect(row.fileHash).toBe("");
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
