import type { MacroKey } from "@/server/mealie/nutrition";

export const MACRO_LABELS: Record<MacroKey, string> = {
  kcal: "Calories",
  protein: "Protein",
  carbs: "Carbs",
  fat: "Fat",
  fibre: "Fibre",
};

/** Calories to the unit, grams to one decimal; "–" when not known. */
export const showMacro = (macro: MacroKey, value: number | undefined) =>
  value === undefined
    ? "–"
    : macro === "kcal"
      ? `${Math.round(value)} kcal`
      : `${Math.round(value * 10) / 10} g`;
