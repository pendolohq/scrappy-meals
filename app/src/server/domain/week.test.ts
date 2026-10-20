import { describe, expect, it } from "vitest";

import {
  addDays,
  isIsoDate,
  isoWeekday,
  today,
  weekDays,
  weekStartOf,
  weekToPlan,
} from "./week";

describe("week helpers", () => {
  it("validates dates strictly", () => {
    expect(isIsoDate("2026-10-19")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-1-5")).toBe(false);
    expect(isIsoDate("../etc")).toBe(false);
  });

  it("finds the Monday of a week", () => {
    expect(weekStartOf("2026-10-19")).toBe("2026-10-19"); // Monday
    expect(weekStartOf("2026-10-25")).toBe("2026-10-19"); // Sunday
    expect(weekStartOf("2027-01-01")).toBe("2026-12-28"); // across the year
  });

  it("numbers weekdays Monday=1 to Sunday=7", () => {
    expect(isoWeekday("2026-10-19")).toBe(1);
    expect(isoWeekday("2026-10-25")).toBe(7);
  });

  it("lists seven days and is unaffected by DST changes", () => {
    const days = weekDays("2026-10-19");
    expect(days).toHaveLength(7);
    expect(days[6]).toBe("2026-10-25");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26"); // EU DST ends 2026-10-25
  });

  it("formats today in local time", () => {
    expect(today(new Date(2026, 9, 19, 23, 30))).toBe("2026-10-19");
  });
});

describe("weekToPlan", () => {
  it("opens this week while nothing is planned in it", () => {
    expect(weekToPlan("2026-10-22", false)).toBe("2026-10-19"); // Thursday
    expect(weekToPlan("2026-10-25", false)).toBe("2026-10-19"); // Sunday
  });

  it("opens next week once this week has meals", () => {
    expect(weekToPlan("2026-10-19", true)).toBe("2026-10-26"); // Monday
    expect(weekToPlan("2026-12-31", true)).toBe("2027-01-04"); // across the year
  });
});
