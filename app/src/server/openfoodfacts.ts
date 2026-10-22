import { z } from "zod";

import "server-only";

import type { OffProduct } from "./domain/product";
import { RetryableError, UserFacingError } from "./errors";

export type OffResult =
  | { status: "found"; product: OffProduct }
  | { status: "not-found" };

const FIELDS = [
  "product_name",
  "brands",
  "quantity",
  "product_quantity",
  "product_quantity_unit",
  "serving_quantity",
  "serving_quantity_unit",
  "nutriments",
].join(",");

// Open Food Facts asks apps to say who they are.
const USER_AGENT =
  "ScrappyMeals/1.0 (+https://github.com/pendolohq/scrappy-meals)";
const TIMEOUT_MS = 8000;
const KJ_PER_KCAL = 4.184;

const DOWN = "Open Food Facts isn't answering. Try again in a minute.";

// Open Food Facts is crowd-sourced: numbers arrive as numbers or strings, and
// anything unreadable counts as absent rather than failing the lookup.
const amount = z
  .unknown()
  .optional()
  .transform((v) => {
    const n =
      typeof v === "number"
        ? v
        : typeof v === "string" && v.trim() !== ""
          ? Number(v)
          : Number.NaN;
    return Number.isFinite(n) && n >= 0 ? n : null;
  });
const text = z
  .unknown()
  .optional()
  .transform((v) => (typeof v === "string" && v.trim() ? v.trim() : null));

const productSchema = z.object({
  product_name: text,
  brands: text,
  quantity: text,
  product_quantity: amount,
  product_quantity_unit: text,
  serving_quantity: amount,
  serving_quantity_unit: text,
  nutriments: z
    .object({
      "energy-kcal_100g": amount,
      "energy-kj_100g": amount,
      proteins_100g: amount,
      carbohydrates_100g: amount,
      fat_100g: amount,
      fiber_100g: amount,
    })
    .catch({
      "energy-kcal_100g": null,
      "energy-kj_100g": null,
      proteins_100g: null,
      carbohydrates_100g: null,
      fat_100g: null,
      fiber_100g: null,
    }),
});

const bodySchema = z.object({
  status: z.unknown(),
  result: z.object({ id: z.unknown() }).optional().catch(undefined),
  product: productSchema.optional(),
});

function toProduct(p: z.output<typeof productSchema>): OffProduct {
  const n = p.nutriments;
  const kcalFromKj =
    n["energy-kcal_100g"] === null && n["energy-kj_100g"] !== null;
  const kcal = kcalFromKj
    ? Math.round((n["energy-kj_100g"] ?? 0) / KJ_PER_KCAL)
    : n["energy-kcal_100g"];
  const per100: OffProduct["per100"] = {};
  // Some values arrive as single-precision noise (8.600000381469727).
  const tidy = (v: number) => Math.round(v * 100) / 100;
  for (const [key, value] of [
    ["kcal", kcal],
    ["protein", n.proteins_100g],
    ["carbs", n.carbohydrates_100g],
    ["fat", n.fat_100g],
    ["fibre", n.fiber_100g],
  ] as const) {
    if (value !== null) {
      per100[key] = tidy(value);
    }
  }
  return {
    name: p.product_name,
    brand: p.brands,
    quantity: p.quantity,
    productQuantity: p.product_quantity,
    productQuantityUnit: p.product_quantity_unit?.toLowerCase() ?? null,
    servingQuantity: p.serving_quantity,
    servingQuantityUnit: p.serving_quantity_unit?.toLowerCase() ?? null,
    per100,
    kcalFromKj,
  };
}

/**
 * Looks a barcode up on Open Food Facts. A product it doesn't know, or a
 * reply we can't read, is "not-found"; it being down or limiting us is a
 * RetryableError. `barcode` is already in canonical form.
 */
export async function lookupOpenFoodFacts(
  barcode: string,
  opts: { fetch?: typeof fetch } = {}
): Promise<OffResult> {
  const url = `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(barcode)}?fields=${FIELDS}`;
  let response: Response;
  try {
    response = await (opts.fetch ?? fetch)(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new RetryableError(DOWN);
  }
  if (response.status === 404) {
    return { status: "not-found" };
  }
  if (response.status === 429 || response.status >= 500) {
    throw new RetryableError(DOWN);
  }
  if (!response.ok) {
    throw new UserFacingError(DOWN);
  }

  let body: z.output<typeof bodySchema> | null = null;
  try {
    const parsed = bodySchema.safeParse(await response.json());
    body = parsed.success ? parsed.data : null;
  } catch {
    // Not JSON at all (a proxy's error page): handled with the other unreadable replies.
  }
  if (body?.status === "success" && body.product) {
    return { status: "found", product: toProduct(body.product) };
  }
  if (body?.status === "failure" && body.result?.id === "product_not_found") {
    return { status: "not-found" };
  }
  console.warn(`Open Food Facts: unreadable reply for ${barcode}`);
  return { status: "not-found" };
}
