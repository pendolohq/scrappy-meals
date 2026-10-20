import { describe, expect, it } from "vitest";

import {
  dayParts,
  formatDay,
  formatPortion,
  formatQuantity,
  formatRange,
  formatWeekLabel,
} from "./format";

describe("format", () => {
  it("formats days and ranges", () => {
    expect(formatDay("2026-10-20")).toBe("Tue 20 Oct");
    expect(formatRange("2026-10-19", "2026-10-25")).toBe("19 Oct – 25 Oct");
  });

  it.each([
    [0, "0"],
    [0.25, "¼"],
    [0.5, "½"],
    [1, "1"],
    [1.5, "1½"],
    [2.75, "2¾"],
    [1.3, "1.3"],
  ])("portion %d -> %s", (n, s) => {
    expect(formatPortion(n)).toBe(s);
  });
});

describe("formatQuantity", () => {
  it("shows up to two decimals and the unit", () => {
    expect(formatQuantity(150, "g")).toBe("150 g");
    expect(formatQuantity(1 / 3, "cup")).toBe("0.33 cup");
    expect(formatQuantity(2, null)).toBe("2");
  });
});

describe("formatWeekLabel", () => {
  it("names the weeks around this one", () => {
    expect(formatWeekLabel("2026-10-19", "2026-10-19")).toBe("This week");
    expect(formatWeekLabel("2026-10-26", "2026-10-19")).toBe("Next week");
    expect(formatWeekLabel("2026-10-12", "2026-10-19")).toBe("Last week");
  });

  it("dates the ones further away, across a clock change", () => {
    expect(formatWeekLabel("2026-11-02", "2026-10-19")).toBe("Week of 2 Nov");
    expect(formatWeekLabel("2026-03-23", "2026-04-06")).toBe("Week of 23 Mar");
  });
});

describe("dayParts", () => {
  it("spells out the weekday and month", () => {
    expect(dayParts("2026-10-20")).toEqual({
      day: 20,
      weekday: "Tuesday",
      month: "October",
    });
  });
});
