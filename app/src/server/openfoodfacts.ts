import { createHmac } from "node:crypto";
import { z } from "zod";

import "server-only";

import type { OffFields } from "./domain/off-contribution";
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
  "serving_size",
  "nutrition_data_per",
  "no_nutrition_data",
  "nutriments",
].join(",");

// Open Food Facts asks apps to say who they are.
const APP_VERSION = "1.0";
const USER_AGENT = `ScrappyMeals/${APP_VERSION} (+https://github.com/pendolohq/scrappy-meals)`;
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
  serving_size: text,
  nutrition_data_per: text,
  no_nutrition_data: text,
  nutriments: z.record(z.string(), z.unknown()).catch({}),
});

const bodySchema = z.object({
  status: z.unknown(),
  result: z.object({ id: z.unknown() }).optional().catch(undefined),
  product: productSchema.optional(),
});

// Every nutrient a table can hold, so "has no nutrition" means none of them.
const NUTRIENTS = [
  "energy",
  "energy-kcal",
  "energy-kj",
  "proteins",
  "carbohydrates",
  "fat",
  "fiber",
  "sugars",
  "saturated-fat",
  "salt",
  "sodium",
];

function toProduct(p: z.output<typeof productSchema>): OffProduct {
  const raw = p.nutriments;
  const value = (key: string) => amount.parse(raw[key]);
  const n = {
    "energy-kcal_100g": value("energy-kcal_100g"),
    "energy-kj_100g": value("energy-kj_100g"),
    proteins_100g: value("proteins_100g"),
    carbohydrates_100g: value("carbohydrates_100g"),
    fat_100g: value("fat_100g"),
    fiber_100g: value("fiber_100g"),
  };
  const sold100g = NUTRIENTS.some((k) => value(`${k}_100g`) !== null);
  const anyBasis = NUTRIENTS.some((k) =>
    ["", "_prepared"].some((form) =>
      ["_100g", "_serving", "_value", ""].some(
        (basis) => value(`${k}${form}${basis}`) !== null
      )
    )
  );
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
    servingSize: p.serving_size,
    nutritionPer: p.nutrition_data_per,
    noNutritionData: ["on", "true", "1"].includes(
      p.no_nutrition_data?.toLowerCase() ?? ""
    ),
    hasNutrients: anyBasis,
    hasNutrients100g: sold100g,
    per100,
    kcalFromKj,
  };
}

/**
 * Looks a barcode up on Open Food Facts. A product it doesn't know, or a
 * reply we can't read, is "not-found"; it being down or limiting us is a
 * RetryableError. `barcode` is already in canonical form. With `strict`, only
 * a real "no such product" reply counts as not found and an unreadable one
 * throws: a write must not take a broken reply for an empty record.
 */
export async function lookupOpenFoodFacts(
  barcode: string,
  opts: { fetch?: typeof fetch; strict?: boolean } = {}
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
  if (response.status === 404 && !opts.strict) {
    return { status: "not-found" };
  }
  if (response.status === 429 || response.status >= 500) {
    throw new RetryableError(DOWN);
  }
  if (!response.ok && response.status !== 404) {
    throw new UserFacingError(DOWN);
  }

  let body: z.output<typeof bodySchema> | null = null;
  try {
    const parsed = bodySchema.safeParse(await response.json());
    body = parsed.success ? parsed.data : null;
  } catch {
    // Not JSON at all (a proxy's error page): handled with the other unreadable replies.
  }
  // v3 also answers "success_with_warnings" and the like, with the product.
  if (
    typeof body?.status === "string" &&
    /^success(_with_\w+)?$/.test(body.status) &&
    body.product
  ) {
    return { status: "found", product: toProduct(body.product) };
  }
  if (
    (body?.status === "failure" || response.status === 404) &&
    body?.result?.id === "product_not_found"
  ) {
    return { status: "not-found" };
  }
  // A 404 with any other body (a proxy's page, a removed endpoint) is not
  // "no such product".
  console.warn(`Open Food Facts: unreadable reply for ${barcode}`);
  if (opts.strict) {
    throw new RetryableError("Open Food Facts gave a reply we couldn't read.");
  }
  return { status: "not-found" };
}

/** The app's own Open Food Facts account, which lets us add products. */
export type OffAccount = { userId: string; password: string };

/** Contributing is on only when both variables are set. */
export function offAccount(
  env: Record<string, string | undefined> = process.env
): OffAccount | null {
  const userId = env.OFF_USER_ID?.trim();
  const password = env.OFF_PASSWORD;
  return userId && password ? { userId, password } : null;
}

/**
 * A stable id for one person that Open Food Facts can block without blocking
 * the app. Salted with the auth secret, so it can't be traced to the user id.
 */
export const offAppUuid = (userId: string, secret: string): string =>
  createHmac("sha256", secret)
    .update(`off:${userId}`)
    .digest("hex")
    .slice(0, 32);

const WRITE_URL = "https://world.openfoodfacts.org/cgi/product_jqm2.pl";
const WRITE_TIMEOUT_MS = 15000;
const RETRY_DELAY_MS = 2000;
const MAX_ERROR = 200;

/** A write Open Food Facts didn't take. The message is safe to store and show. */
export class OffWriteError extends Error {
  name = "OffWriteError";
}

type Attempt = { error?: undefined } | { error: OffWriteError; retry: boolean };

/**
 * Sends `fields` to Open Food Facts as `account`. One retry after a pause for
 * a network error, a timeout, a 429 or a 5xx; a 4xx or a refusal is final.
 * Throws OffWriteError; the password never appears in its message.
 */
export async function writeOpenFoodFacts(
  fields: OffFields,
  account: OffAccount,
  appUuid: string,
  opts: {
    fetch?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<void> {
  const body = new URLSearchParams({
    ...fields,
    user_id: account.userId,
    password: account.password,
    app_name: "ScrappyMeals",
    app_version: APP_VERSION,
    app_uuid: appUuid,
  });
  const sleep =
    opts.sleep ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));

  const send = async (): Promise<Attempt> => {
    let response: Response;
    try {
      response = await (opts.fetch ?? fetch)(WRITE_URL, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        // The credentials are in the body: never send them on to a redirect.
        redirect: "error",
        signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
      });
    } catch {
      return {
        error: new OffWriteError("Open Food Facts could not be reached"),
        retry: true,
      };
    }
    if (!response.ok) {
      return {
        error: new OffWriteError(`Open Food Facts answered ${response.status}`),
        retry: response.status === 429 || response.status >= 500,
      };
    }
    const reply = (await response.json().catch(() => null)) as {
      status?: unknown;
      status_verbose?: unknown;
    } | null;
    if (reply?.status === 1) {
      return {};
    }
    // A refusal (wrong login, bad data) won't change on a retry.
    const why =
      typeof reply?.status_verbose === "string"
        ? `: ${reply.status_verbose}`
        : "";
    return {
      error: new OffWriteError(
        `Open Food Facts didn't save it${why}`
          .split(account.password)
          .join("***")
          .slice(0, MAX_ERROR)
      ),
      retry: false,
    };
  };

  let result = await send();
  if (result.error && result.retry) {
    await sleep(RETRY_DELAY_MS);
    result = await send();
  }
  if (result.error) {
    throw result.error;
  }
}
