import { formatAmount } from "@/lib/format";
import {
  MACRO_KEYS,
  type MacroKey,
  type Macros,
} from "@/server/mealie/nutrition";

export const MACROS: Record<
  MacroKey,
  { label: string; unit: string; max: number }
> = {
  kcal: { label: "Energy", unit: "kcal", max: 1000 },
  protein: { label: "Protein", unit: "g", max: 100 },
  carbs: { label: "Carbs", unit: "g", max: 100 },
  fat: { label: "Fat", unit: "g", max: 100 },
  fibre: { label: "Fibre", unit: "g", max: 100 },
};

/** "Per serving: 240 kcal · 4.3 g protein"; only what is known. */
export const nutritionLine = (prefix: string, values: Partial<Macros>) => {
  const parts = MACRO_KEYS.flatMap((key) => {
    const v = values[key];
    if (v === undefined) {
      return [];
    }
    return key === "kcal"
      ? [`${formatAmount(v)} kcal`]
      : [`${v} g ${MACROS[key].label.toLowerCase()}`];
  });
  return parts.length > 0
    ? `${prefix}: ${parts.join(" · ")}`
    : "No nutrition values yet";
};

/** The nutrition of `servings` servings, to one decimal. */
export const scaled = (
  values: Partial<Macros>,
  servings: number
): Partial<Macros> =>
  Object.fromEntries(
    MACRO_KEYS.flatMap((k) =>
      values[k] === undefined
        ? []
        : [[k, Math.round(values[k] * servings * 10) / 10]]
    )
  );
