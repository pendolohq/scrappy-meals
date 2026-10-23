import type { Macros } from "../mealie/nutrition";

/** What one `measure` weighs: "1 cup" at 180 g is `{ measure: "cup", grams: 180 }`. */
export type UsdaPortion = {
  /** What the picker shows: "1 cup", "3 cloves". */
  label: string;
  /** The unit, lowercase, without the count or any size note: "cup", "clove", "fl oz". */
  measure: string;
  /** Grams for one of `measure`. */
  grams: number;
};

/** The data type of a food whose values someone typed in from a label. */
export const OWN_VALUES = "Own values";

export type UsdaFood = {
  fdcId: number;
  description: string;
  dataType: string;
  per100g: Partial<Macros>;
  portions: UsdaPortion[];
};

export type UsdaHit = {
  fdcId: number;
  description: string;
  dataType: string;
  foodCategory: string | null;
  per100g: Partial<Macros>;
};

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

// FDC nutrient numbers. Energy is 1008 (kcal; 1062 is kJ). Foundation foods
// often have only the Atwater estimates. Carbohydrate "by difference" includes
// fibre, the US way. It's stored as FDC gives it; `usda-check.ts` takes the
// fibre out when it counts a line.
const KCAL = [1008, 2047, 2048];
const PROTEIN = [1003];
const FAT = [1004];
const CARBS = [1005, 1050];
const FIBRE = [1079];

function macrosFrom(amounts: Map<number, number>): Partial<Macros> {
  const first = (ids: number[]) => {
    for (const id of ids) {
      const value = amounts.get(id);
      if (value !== undefined) {
        return value;
      }
    }
    return undefined;
  };
  const found = {
    kcal: first(KCAL),
    protein: first(PROTEIN),
    carbs: first(CARBS),
    fat: first(FAT),
    fibre: first(FIBRE),
  };
  return Object.fromEntries(
    Object.entries(found).filter(([, v]) => v !== undefined)
  ) as Partial<Macros>;
}

function nutrientAmounts(
  list: unknown,
  read: (n: Json) => [unknown, unknown]
): Map<number, number> {
  const amounts = new Map<number, number>();
  for (const n of Array.isArray(list) ? list : []) {
    if (!isObject(n)) {
      continue;
    }
    const [id, amount] = read(n);
    if (num(id) !== null && num(amount) !== null) {
      amounts.set(id as number, amount as number);
    }
  }
  return amounts;
}

/** The hits of an FDC search response; none for anything else. */
export function parseSearch(json: unknown): UsdaHit[] {
  if (!isObject(json) || !Array.isArray(json.foods)) {
    return [];
  }
  return json.foods.flatMap((f): UsdaHit[] => {
    if (!isObject(f)) {
      return [];
    }
    const fdcId = num(f.fdcId);
    const description = str(f.description);
    if (fdcId === null || !description) {
      return [];
    }
    return [
      {
        fdcId,
        description,
        dataType: str(f.dataType) ?? "",
        foodCategory: str(f.foodCategory),
        per100g: macrosFrom(
          nutrientAmounts(f.foodNutrients, (n) => [n.nutrientId, n.value])
        ),
      },
    ];
  });
}

/** Reference servings, not measures of the food. */
const NOT_A_MEASURE = /\b(racc|nlea)\b|not specified/i;

const LEADING_COUNT = /^\s*(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*/;

function leadingCount(text: string): number | null {
  const m = LEADING_COUNT.exec(text);
  if (!m) {
    return null;
  }
  const parts = m[1].split(/\s+/);
  return parts.reduce((sum, part) => {
    const [a, b] = part.split("/");
    return sum + (b ? Number(a) / Number(b) : Number(a));
  }, 0);
}

/** "cup, sliced" -> "cup"; `fruit (2" dia)` -> "fruit"; "cloves" -> "clove". */
function measureOf(text: string): string {
  const head = text
    .replace(LEADING_COUNT, "")
    .split(",")[0]
    .replace(/\(.*$/, "")
    .trim()
    .toLowerCase();
  return head.length > 3 && head.endsWith("s") && !head.endsWith("ss")
    ? head.slice(0, -1)
    : head;
}

function parsePortion(p: unknown): UsdaPortion | null {
  if (!isObject(p)) {
    return null;
  }
  const gramWeight = num(p.gramWeight);
  if (gramWeight === null || gramWeight <= 0) {
    return null;
  }
  const unit = isObject(p.measureUnit) ? str(p.measureUnit.name) : null;
  const description = str(p.portionDescription);
  const modifier = str(p.modifier);
  // FNDDS describes the portion in text; the others give amount + modifier,
  // and Foundation may name a real unit ("egg") in measureUnit.
  const text =
    description ??
    [unit && unit !== "undetermined" ? unit : null, modifier]
      .filter(Boolean)
      .join(", ");
  if (!text || NOT_A_MEASURE.test(`${text} ${unit ?? ""}`)) {
    return null;
  }
  const count =
    (description ? leadingCount(description) : null) ?? num(p.amount) ?? 1;
  const measure = measureOf(text);
  if (count <= 0 || !measure) {
    return null;
  }
  return {
    label: description ?? `${count} ${text}`,
    measure,
    grams: Math.round((gramWeight / count) * 1000) / 1000,
  };
}

/** The foods of an FDC `/foods` response (format "full"); none for anything else. */
export function parseFoodDetails(json: unknown): UsdaFood[] {
  if (!Array.isArray(json)) {
    return [];
  }
  return json.flatMap((f): UsdaFood[] => {
    if (!isObject(f)) {
      return [];
    }
    const fdcId = num(f.fdcId);
    const description = str(f.description);
    if (fdcId === null || !description) {
      return [];
    }
    return [
      {
        fdcId,
        description,
        dataType: str(f.dataType) ?? "",
        per100g: macrosFrom(
          nutrientAmounts(f.foodNutrients, (n) => [
            isObject(n.nutrient) ? n.nutrient.id : null,
            n.amount,
          ])
        ),
        portions: (Array.isArray(f.foodPortions) ? f.foodPortions : []).flatMap(
          (p) => parsePortion(p) ?? []
        ),
      },
    ];
  });
}

/**
 * Salt, water, black coffee: nothing a recipe's totals would notice, so a line
 * with no amount ("salt") counts as 0 g. Needs the four main figures.
 */
export function isNegligible(per100g: Partial<Macros>): boolean {
  const { kcal, protein, carbs, fat, fibre } = per100g;
  if (
    kcal === undefined ||
    protein === undefined ||
    carbs === undefined ||
    fat === undefined
  ) {
    return false;
  }
  return (
    kcal <= 5 &&
    [protein, carbs, fat, fibre ?? 0].every((grams) => grams <= 0.5)
  );
}
