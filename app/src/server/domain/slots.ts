// The schema's enum is built from this list, not the other way round, so
// client components can import it without pulling drizzle into the bundle.
export const SLOT_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

export const MAX_SNACK_SLOTS = 4;
export const DEFAULT_SNACK_SLOTS = 2;

export type DaySlot = {
  slot: SlotType;
  snackIndex: number;
  label: string;
  active: boolean;
};

const SNACK_LABELS = [
  "Morning snack",
  "Afternoon snack",
  "Evening snack",
  "Late-night snack",
];

const MEAL_LABELS: Record<Exclude<SlotType, "snack">, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

export function slotLabel(slot: SlotType, snackIndex: number): string {
  return slot === "snack"
    ? (SNACK_LABELS[snackIndex] ?? `Snack ${snackIndex + 1}`)
    : MEAL_LABELS[slot];
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
  const snack = (i: number): DaySlot[] =>
    i < snackSlots || used.has(i)
      ? [
          {
            slot: "snack",
            snackIndex: i,
            label: slotLabel("snack", i),
            active: i < snackSlots,
          },
        ]
      : [];
  const meal = (slot: Exclude<SlotType, "snack">): DaySlot => ({
    slot,
    snackIndex: 0,
    label: slotLabel(slot, 0),
    active: true,
  });
  return [
    meal("breakfast"),
    ...snack(0),
    meal("lunch"),
    ...snack(1),
    meal("dinner"),
    ...snack(2),
    ...snack(3),
  ];
}
