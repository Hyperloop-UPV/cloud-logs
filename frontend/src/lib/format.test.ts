import { describe, expect, it } from "vitest";
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
  it("formats 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats byte values under 1 KB without decimals", () => {
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats KB values without decimals", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("2 KB");
    expect(formatBytes(1024 * 100)).toBe("100 KB");
  });

  it("formats MB values with 1 decimal", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 1.5)).toBe("1.5 MB");
    expect(formatBytes(1024 * 1024 * 25.26)).toBe("25.3 MB");
  });

  it("formats GB values with 1 decimal", () => {
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
    expect(formatBytes(1024 ** 3 * 3.75)).toBe("3.8 GB");
  });

  it("formats TB values with 1 decimal", () => {
    expect(formatBytes(1024 ** 4)).toBe("1.0 TB");
    expect(formatBytes(1024 ** 4 * 10)).toBe("10.0 TB");
  });

  it("returns EMPTY for null, undefined, NaN, or negative bytes", () => {
    expect(formatBytes(null)).toBe(EMPTY);
    expect(formatBytes(undefined)).toBe(EMPTY);
    expect(formatBytes(Number.NaN)).toBe(EMPTY);
    expect(formatBytes(-1)).toBe(EMPTY);
    expect(formatBytes(-1024)).toBe(EMPTY);
  });
});

describe("formatDuration", () => {
  it("returns <1m for durations under one minute", () => {
    const start = "2026-03-12T10:00:00Z";
    const end = "2026-03-12T10:00:20Z"; // 20s < 30s rounds to 0 minutes
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

  it("formats durations exceeding 24 hours (days)", () => {
    const start = "2026-03-12T10:00:00Z";
    const end = "2026-03-13T12:00:00Z"; // 26 hours
    expect(formatDuration(start, end)).toBe("26h 0m");
  });

  it("returns EMPTY when start or end is missing or null", () => {
    expect(formatDuration(null, "2026-03-12T10:00:00Z")).toBe(EMPTY);
    expect(formatDuration("2026-03-12T10:00:00Z", null)).toBe(EMPTY);
    expect(formatDuration(undefined, undefined)).toBe(EMPTY);
    expect(formatDuration("", "")).toBe(EMPTY);
  });

  it("returns EMPTY for negative durations (end before start)", () => {
    const start = "2026-03-12T12:00:00Z";
    const end = "2026-03-12T10:00:00Z";
    expect(formatDuration(start, end)).toBe(EMPTY);
  });

  it("returns EMPTY for invalid dates", () => {
    expect(formatDuration("not-a-date", "2026-03-12T10:00:00Z")).toBe(EMPTY);
    expect(formatDuration("2026-03-12T10:00:00Z", "invalid")).toBe(EMPTY);
  });
});

describe("formatDate and formatRelativeTime", () => {
  it("formats valid ISO dates with en-GB convention", () => {
    const iso = "2026-03-12T10:00:00Z";
    expect(formatDate(iso)).toBe("12 Mar 2026");
  });

  it("handles ISO strings with timezone offsets", () => {
    const iso = "2026-03-12T02:00:00+02:00";
    expect(formatDate(iso)).toBe("12 Mar 2026");
  });

  it("returns EMPTY for invalid, null, or undefined dates", () => {
    expect(formatDate(null)).toBe(EMPTY);
    expect(formatDate(undefined)).toBe(EMPTY);
    expect(formatDate("")).toBe(EMPTY);
    expect(formatDate("gibberish")).toBe(EMPTY);
  });

  it("formats relative time correctly for various horizons", () => {
    const now = Date.now();
    // 0 seconds ago -> "now"
    expect(formatRelativeTime(new Date(now).toISOString())).toBe("now");
    // 30 seconds ago -> "30 seconds ago"
    expect(formatRelativeTime(new Date(now - 30 * 1000).toISOString())).toBe(
      "30 seconds ago",
    );
    // 5 minutes ago
    expect(
      formatRelativeTime(new Date(now - 5 * 60 * 1000).toISOString()),
    ).toBe("5 minutes ago");
    // 2 hours ago
    expect(
      formatRelativeTime(new Date(now - 2 * 3600 * 1000).toISOString()),
    ).toBe("2 hours ago");
    // 1 day ago -> "yesterday"
    expect(
      formatRelativeTime(new Date(now - 24 * 3600 * 1000).toISOString()),
    ).toBe("yesterday");
    // 3 days ago
    expect(
      formatRelativeTime(new Date(now - 3 * 24 * 3600 * 1000).toISOString()),
    ).toBe("3 days ago");
    // years ago
    expect(
      formatRelativeTime(
        new Date(now - 365 * 24 * 3600 * 1000 * 2).toISOString(),
      ),
    ).toBe("2 years ago");
    // formatRelative and formatRelativeTime are aliases
    expect(formatRelativeTime).toBe(formatRelative);
  });

  it("returns EMPTY for invalid, null, or undefined inputs in formatRelativeTime", () => {
    expect(formatRelativeTime(null)).toBe(EMPTY);
    expect(formatRelativeTime(undefined)).toBe(EMPTY);
    expect(formatRelativeTime("")).toBe(EMPTY);
    expect(formatRelativeTime("not-a-date")).toBe(EMPTY);
  });
});

describe("formatMonthKey", () => {
  it("formats YYYY_MM keys to Month Year", () => {
    expect(formatMonthKey("2026_10")).toBe("Oct 2026");
    expect(formatMonthKey("2026_01")).toBe("Jan 2026");
    expect(formatMonthKey("2025_12")).toBe("Dec 2025");
  });

  it("returns input string as-is for malformed or unrecognized keys", () => {
    expect(formatMonthKey("2026-10")).toBe("2026-10");
    expect(formatMonthKey("October 2026")).toBe("October 2026");
    expect(formatMonthKey("invalid")).toBe("invalid");
    expect(formatMonthKey("")).toBe("");
  });
});

describe("formatDateTime, formatRange, formatCount", () => {
  it("formats date and time", () => {
    const iso = "2026-03-12T14:30:00Z";
    // Check it includes day, month, year
    expect(formatDateTime(iso)).toMatch(/12 Mar 2026/);
    expect(formatDateTime(null)).toBe(EMPTY);
  });

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

  it("formats counts with thousand separators", () => {
    expect(formatCount(1234)).toBe("1,234");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(null)).toBe(EMPTY);
    expect(formatCount(undefined)).toBe(EMPTY);
  });
});
