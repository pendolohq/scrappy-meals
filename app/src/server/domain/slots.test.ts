import { describe, expect, it } from "vitest";

import {
  DEFAULT_SNACK_SLOTS,
  daySlots,
  MAX_SNACK_SLOTS,
  SLOT_TYPES,
  slotLabel,
} from "./slots";

const keys = (slots: ReturnType<typeof daySlots>) =>
  slots.map((s) => `${s.slot}-${s.snackIndex}`);

describe("slots", () => {
  it("exposes the slot types and snack limits", () => {
    expect([...SLOT_TYPES].toSorted()).toEqual([
      "breakfast",
      "dinner",
      "lunch",
      "snack",
    ]);
    expect(MAX_SNACK_SLOTS).toBe(4);
    expect(DEFAULT_SNACK_SLOTS).toBe(2);
  });

  it("labels meals and each snack index", () => {
    expect([
      slotLabel("breakfast", 0),
      slotLabel("lunch", 0),
      slotLabel("dinner", 0),
      slotLabel("snack", 0),
      slotLabel("snack", 1),
      slotLabel("snack", 2),
      slotLabel("snack", 3),
    ]).toEqual([
      "Breakfast",
      "Lunch",
      "Dinner",
      "Morning snack",
      "Afternoon snack",
      "Evening snack",
      "Late-night snack",
    ]);
  });

  it("has only the three meals when there are no snack slots", () => {
    expect(keys(daySlots(0))).toEqual(["breakfast-0", "lunch-0", "dinner-0"]);
  });

  it("puts one snack slot after breakfast", () => {
    expect(keys(daySlots(1))).toEqual([
      "breakfast-0",
      "snack-0",
      "lunch-0",
      "dinner-0",
    ]);
  });

  it("interleaves two snack slots in eating order", () => {
    expect(keys(daySlots(2))).toEqual([
      "breakfast-0",
      "snack-0",
      "lunch-0",
      "snack-1",
      "dinner-0",
    ]);
  });

  it("puts the evening and late-night snacks after dinner with four slots", () => {
    expect(keys(daySlots(4))).toEqual([
      "breakfast-0",
      "snack-0",
      "lunch-0",
      "snack-1",
      "dinner-0",
      "snack-2",
      "snack-3",
    ]);
  });

  it("carries the label and marks every slot active when none is beyond the count", () => {
    const slots = daySlots(2);
    expect(slots.every((s) => s.active)).toBe(true);
    expect(slots.map((s) => s.label)).toEqual([
      "Breakfast",
      "Morning snack",
      "Lunch",
      "Afternoon snack",
      "Dinner",
    ]);
  });

  it("shows an inactive snack slot that holds a meal in its eating-order place", () => {
    const slots = daySlots(1, [{ slot: "snack", snackIndex: 2 }]);
    expect(keys(slots)).toEqual([
      "breakfast-0",
      "snack-0",
      "lunch-0",
      "dinner-0",
      "snack-2",
    ]);
    expect(slots.map((s) => [s.slot, s.snackIndex, s.active])).toEqual([
      ["breakfast", 0, true],
      ["snack", 0, true],
      ["lunch", 0, true],
      ["dinner", 0, true],
      ["snack", 2, false],
    ]);
    expect(slots[4].label).toBe("Evening snack");
  });

  it("places an inactive afternoon snack between lunch and dinner", () => {
    const slots = daySlots(0, [{ slot: "snack", snackIndex: 1 }]);
    expect(keys(slots)).toEqual([
      "breakfast-0",
      "lunch-0",
      "snack-1",
      "dinner-0",
    ]);
    expect(slots[2].active).toBe(false);
  });

  it("does not duplicate or deactivate slots that meals use within the count", () => {
    const slots = daySlots(2, [
      { slot: "snack", snackIndex: 1 },
      { slot: "snack", snackIndex: 1 },
      { slot: "lunch", snackIndex: 0 },
    ]);
    expect(keys(slots)).toEqual(keys(daySlots(2)));
    expect(slots.every((s) => s.active)).toBe(true);
  });
});
