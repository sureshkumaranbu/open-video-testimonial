import { describe, expect, it } from "vitest";
import { formatSourceDate } from "@/lib/dates";
import { parseSourceDate } from "@/lib/importers/html";

describe("IMP-05 fuzzy dates", () => {
  it("IMP-05 month-only dates are stored as the 1st (UTC) with precision month", () => {
    for (const raw of ["2026-10", "2026/10", "Oct 2026", "October 2026", "oct. 2026"]) {
      const d = parseSourceDate(raw);
      expect(d, raw).toEqual({ value: new Date(Date.UTC(2026, 9, 1)), precision: "month" });
    }
  });

  it("IMP-05 a month-only date shows as “Oct 2026”, never a made-up day", () => {
    const d = parseSourceDate("2026-10")!;
    expect(formatSourceDate(d.value, d.precision, "en")).toBe("Oct 2026");
    // Still October for viewers west of UTC: formatting is in UTC.
    expect(formatSourceDate(new Date(Date.UTC(2026, 9, 1)), "month", "en-US")).toBe("Oct 2026");
  });

  it("IMP-05 years, full dates and epoch numbers keep their own precision", () => {
    expect(parseSourceDate("2025")).toEqual({ value: new Date(Date.UTC(2025, 0, 1)), precision: "year" });
    expect(formatSourceDate(parseSourceDate("2025")!.value, "year", "en")).toBe("2025");
    expect(parseSourceDate("2026-10-12")).toEqual({ value: new Date(Date.UTC(2026, 9, 12)), precision: "day" });
    expect(formatSourceDate(parseSourceDate("2026-10-12")!.value, "day", "en-GB")).toBe("12 Oct 2026");
    expect(parseSourceDate("2026-10-12T09:14:00-07:00")?.precision).toBe("day");
    expect(parseSourceDate(1_791_000_000)?.value.getTime()).toBe(1_791_000_000_000);
    expect(parseSourceDate("1791000000000")?.value.getTime()).toBe(1_791_000_000_000);
  });

  it("IMP-05 nonsense, far-future and ancient dates are left out", () => {
    for (const raw of ["", "soon", "2026-13", "Smarch 2026", "2999-01-01", "1970-01-01", null, undefined, {}]) {
      expect(parseSourceDate(raw), String(raw)).toBeUndefined();
    }
  });

  it("IMP-05 an unknown locale falls back to English", () => {
    expect(formatSourceDate(new Date(Date.UTC(2026, 9, 1)), "month", "not a locale!")).toBe("Oct 2026");
  });
});
