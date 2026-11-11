import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY,
  formatBytes,
  formatCount,
  formatDate,
  formatDateTime,
  formatDuration,
  formatMonthKey,
  formatRange,
  formatRelative,
  formatRelativeTime,
} from "./format";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1, "1 B"],
    [500, "500 B"],
    [1023, "1023 B"],
    [1024, "1 KB"],
    [1536, "2 KB"],
    [1024 * 100, "100 KB"],
    [1024 * 1024, "1.0 MB"],
    [1024 * 1024 * 1.5, "1.5 MB"],
    [1024 * 1024 * 25.26, "25.3 MB"],
    [1024 ** 3, "1.0 GB"],
    [1024 ** 3 * 3.75, "3.8 GB"],
    [1024 ** 4, "1.0 TB"],
    [1024 ** 4 * 10, "10.0 TB"],
  ])("formats %s bytes to %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it.each([null, undefined, Number.NaN, -1, -1024])(
    "returns EMPTY for invalid byte value: %s",
    (value) => {
      expect(formatBytes(value)).toBe(EMPTY);
    },
  );
});

describe("formatDuration", () => {
  it("returns <1m for durations under one minute", () => {
    const start = "2026-03-12T10:00:00Z";
    const end = "2026-03-12T10:00:20Z";
    expect(formatDuration(start, end)).toBe("<1m");
  });

  it("formats minute durations", () => {
    const start = "2026-03-12T10:00:00Z";
    const end = "2026-03-12T10:45:00Z";
    expect(formatDuration(start, end)).toBe("45m");
  });

  it("formats hours and minutes", () => {
    const start = "2026-03-12T10:00:00Z";
    const end = "2026-03-12T12:35:00Z";
    expect(formatDuration(start, end)).toBe("2h 35m");
  });

  it("formats durations exceeding 24 hours", () => {
    const start = "2026-03-12T10:00:00Z";
    const end = "2026-03-13T12:00:00Z";
    expect(formatDuration(start, end)).toBe("26h 0m");
  });

  it.each([
    [null, "2026-03-12T10:00:00Z"],
    ["2026-03-12T10:00:00Z", null],
    [undefined, undefined],
    ["", ""],
  ])("returns EMPTY when start or end is missing: %s, %s", (start, end) => {
    expect(formatDuration(start, end)).toBe(EMPTY);
  });

  it("returns EMPTY for negative durations (end before start)", () => {
    expect(formatDuration("2026-03-12T12:00:00Z", "2026-03-12T10:00:00Z")).toBe(
      EMPTY,
    );
  });

  it.each([
    ["not-a-date", "2026-03-12T10:00:00Z"],
    ["2026-03-12T10:00:00Z", "invalid"],
  ])("returns EMPTY for invalid date strings: %s, %s", (start, end) => {
    expect(formatDuration(start, end)).toBe(EMPTY);
  });
});

describe("formatDate", () => {
  it("formats valid ISO dates with en-GB convention", () => {
    expect(formatDate("2026-03-12T10:00:00Z")).toBe("12 Mar 2026");
  });

  it("handles ISO strings with timezone offsets", () => {
    expect(formatDate("2026-03-12T02:00:00+02:00")).toBe("12 Mar 2026");
  });

  it.each([null, undefined, "", "gibberish"])(
    "returns EMPTY for invalid, null, or undefined date: %s",
    (value) => {
      expect(formatDate(value)).toBe(EMPTY);
    },
  );
});

describe("formatRelativeTime", () => {
  const baseTime = new Date("2026-03-12T12:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(baseTime);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["2026-03-12T12:00:00Z", "now"],
    ["2026-03-12T11:59:30Z", "30 seconds ago"],
    ["2026-03-12T11:55:00Z", "5 minutes ago"],
    ["2026-03-12T10:00:00Z", "2 hours ago"],
    ["2026-03-11T12:00:00Z", "yesterday"],
    ["2026-03-09T12:00:00Z", "3 days ago"],
    ["2024-03-12T12:00:00Z", "2 years ago"],
  ])("formats %s as %s", (iso, expected) => {
    expect(formatRelativeTime(iso)).toBe(expected);
  });

  it("is aliased to formatRelative", () => {
    expect(formatRelativeTime).toBe(formatRelative);
  });

  it.each([null, undefined, "", "not-a-date"])(
    "returns EMPTY for invalid relative time input: %s",
    (input) => {
      expect(formatRelativeTime(input)).toBe(EMPTY);
    },
  );
});

describe("formatMonthKey", () => {
  it.each([
    ["2026_10", "Oct 2026"],
    ["2026_01", "Jan 2026"],
    ["2025_12", "Dec 2025"],
  ])("formats valid month key %s to %s", (key, expected) => {
    expect(formatMonthKey(key)).toBe(expected);
  });

  it.each(["2026-10", "October 2026", "invalid", ""])(
    "returns input string as-is for malformed or unrecognized key: %s",
    (key) => {
      expect(formatMonthKey(key)).toBe(key);
    },
  );
});

describe("formatDateTime", () => {
  it("formats date and time", () => {
    const iso = "2026-03-12T14:30:00Z";
    expect(formatDateTime(iso)).toMatch(/12 Mar 2026/);
    expect(formatDateTime(null)).toBe(EMPTY);
  });
});

describe("formatRange", () => {
  it("formats ranges on same day vs different days", () => {
    const start = "2026-03-12T10:00:00Z";
    const sameDayEnd = "2026-03-12T12:00:00Z";
    const nextDayEnd = "2026-03-13T12:00:00Z";

    expect(formatRange(start, sameDayEnd)).toContain("→");
    expect(formatRange(start, nextDayEnd)).toContain("13 Mar 2026");
    expect(formatRange(null, sameDayEnd)).toBe(
      `… → ${formatDateTime(sameDayEnd)}`,
    );
    expect(formatRange(start, null)).toBe(`${formatDateTime(start)} → …`);
    expect(formatRange(null, null)).toBe(EMPTY);
  });
});

describe("formatCount", () => {
  it.each([
    [1234, "1,234"],
    [0, "0"],
  ])("formats count %s as %s", (count, expected) => {
    expect(formatCount(count)).toBe(expected);
  });

  it.each([null, undefined])("returns EMPTY for %s", (value) => {
    expect(formatCount(value)).toBe(EMPTY);
  });
});
