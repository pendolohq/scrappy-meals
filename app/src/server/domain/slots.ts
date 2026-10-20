// The schema's enum is built from this list, not the other way round, so
// client components can import it without pulling drizzle into the bundle.
export const SLOT_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

type MealType = Exclude<SlotType, "snack">;

const MEALS: { slot: MealType; label: string }[] = [
  { slot: "breakfast", label: "Breakfast" },
  { slot: "lunch", label: "Lunch" },
  { slot: "dinner", label: "Dinner" },
];

// Snack n always has the same name and place, so changing the household's
// count never renames or moves a planned meal. The schema's check constraint
// on snack_index is built from this length: adding a snack here needs a
// migration (`drizzle-kit generate`).
const SNACKS: { label: string; after: MealType }[] = [
  { label: "Morning snack", after: "breakfast" },
  { label: "Afternoon snack", after: "lunch" },
  { label: "Evening snack", after: "dinner" },
  { label: "Late-night snack", after: "dinner" },
];

export const MAX_SNACK_SLOTS = SNACKS.length;
export const DEFAULT_SNACK_SLOTS = 2;

export type DaySlot = {
  slot: SlotType;
  snackIndex: number;
  label: string;
  active: boolean;
};

export function slotLabel(slot: SlotType, snackIndex: number): string {
  return slot === "snack"
    ? (SNACKS[snackIndex]?.label ?? "Snack")
    : MEALS.find((m) => m.slot === slot)!.label;
}

/** Every slot a day can have, in eating order. */
const ALL_SLOTS = MEALS.flatMap(({ slot }) => [
  { slot: slot as SlotType, snackIndex: 0 },
  ...SNACKS.flatMap((s, i) =>
    s.after === slot ? [{ slot: "snack" as const, snackIndex: i }] : []
  ),
]);

/** Where a slot falls in the day, for sorting meals into eating order. */
export function slotRank(slot: SlotType, snackIndex: number): number {
  return ALL_SLOTS.findIndex(
    (s) => s.slot === slot && s.snackIndex === snackIndex
  );
}

/**
 * A day's slots in eating order. Snack slots past the household's count
 * appear (inactive) only while a meal sits in them, so lowering the count
 * never hides planned meals.
 */
export function daySlots(
  snackSlots: number,
  meals: { slot: SlotType; snackIndex: number }[] = []
): DaySlot[] {
  const used = new Set(
    meals.filter((m) => m.slot === "snack").map((m) => m.snackIndex)
  );
  return ALL_SLOTS.filter(
    (s) =>
      s.slot !== "snack" || s.snackIndex < snackSlots || used.has(s.snackIndex)
  ).map((s) => ({
    ...s,
    label: slotLabel(s.slot, s.snackIndex),
    active: s.slot !== "snack" || s.snackIndex < snackSlots,
  }));
}
