import "server-only";

import {
  parseFoodDetails,
  parseSearch,
  type UsdaFood,
  type UsdaHit,
} from "../domain/usda";
import { RetryableError } from "../errors";

const BASE = "https://api.nal.usda.gov/fdc/v1";
const TIMEOUT_MS = 15_000;
const BATCH = 20;
// Drinks and prepared foods are only in Survey (FNDDS).
const DATA_TYPES = ["Foundation", "SR Legacy", "Survey (FNDDS)"];

type Env = Record<string, string | undefined>;

/** Checking against USDA is on when the server has an FDC API key. */
export const usdaEnabled = (env: Env = process.env) =>
  Boolean(env.USDA_FDC_API_KEY?.trim());

export type UsdaClient = {
  search: (query: string, pageSize?: number) => Promise<UsdaHit[]>;
  /** Full details (with portions) for the ids, 20 to a request. */
  foods: (ids: number[]) => Promise<UsdaFood[]>;
};

/** FoodData Central, or null when `USDA_FDC_API_KEY` isn't set. */
export function usdaClient(
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch
): UsdaClient | null {
  const apiKey = env.USDA_FDC_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  // The key goes in a header so it never ends up in a URL or a log.
  async function post(path: string, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchImpl(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKey! },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (err) {
      console.error("USDA request failed", err);
      throw new RetryableError("USDA didn't answer. Try again in a minute.");
    }
    if (res.status === 429 || res.status >= 500) {
      console.error(`USDA answered ${res.status}`);
      throw new RetryableError("USDA didn't answer. Try again in a minute.");
    }
    if (!res.ok) {
      throw new Error(`USDA FoodData Central answered ${res.status}`);
    }
    return res.json();
  }

  return {
    async search(query, pageSize = 10) {
      return parseSearch(
        await post("/foods/search", {
          query,
          dataType: DATA_TYPES,
          pageSize,
        })
      );
    },
    async foods(ids) {
      const found: UsdaFood[] = [];
      for (let i = 0; i < ids.length; i += BATCH) {
        found.push(
          ...parseFoodDetails(
            await post("/foods", {
              fdcIds: ids.slice(i, i + BATCH),
              format: "full",
            })
          )
        );
      }
      return found;
    },
  };
}
