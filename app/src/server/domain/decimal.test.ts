import { describe, expect, it } from "vitest";

import { parseDecimal } from "./decimal";

describe("parseDecimal", () => {
  it.each([
    ["12", 12],
    ["0", 0],
    ["12.5", 12.5],
    ["12,5", 12.5],
    ["12.25", 12.25],
    ["0.250", 0.25],
    ["0,250", 0.25],
    ["1200,500", 1200.5],
    ["1,200.5", 1200.5],
    ["1.200,5", 1200.5],
    ["1,200,000", 1_200_000],
    ["1.200.000", 1_200_000],
    [" 7 ", 7],
  ])("reads %j as %d whatever the choice for groups of three", (text, n) => {
    expect(parseDecimal(text, "thousands")).toBe(n);
    expect(parseDecimal(text, "refuse")).toBe(n);
  });

  it.each([
    ["1,200", 1200],
    ["1.200", 1200],
    ["12,500", 12_500],
  ])("reads the lone group of three %j as thousands when asked", (text, n) => {
    expect(parseDecimal(text, "thousands")).toBe(n);
  });

  it.each(["1,200", "1.200"])(
    "refuses the lone group of three %j when asked not to guess",
    (text) => {
      expect(parseDecimal(text, "refuse")).toBeNull();
    }
  );

  it.each([
    "",
    "abc",
    "-3",
    "1.2.3",
    "1,20,000",
    "1.200,5,5",
    "12,5.000",
    ".5",
    "5.",
    "1 200",
    "10-12",
  ])("rejects %j", (text) => {
    expect(parseDecimal(text, "thousands")).toBeNull();
  });
});
