import createClient, { type Middleware } from "openapi-fetch";

import "server-only";

import type { paths } from "./schema";

/** Mealie version the committed schema was generated from (scripts/mealie-types.mjs). */
export const MEALIE_SCHEMA_VERSION = "v3.29.0";

const DEFAULT_TIMEOUT_MS = 10_000;
const IMPORT_TIMEOUT_MS = 60_000;

export type MealieClient = ReturnType<typeof createMealieClient>;

export class MealieError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly detail: unknown
  ) {
    super(`Mealie ${path} failed: ${status} ${describe(detail)}`);
    this.name = "MealieError";
  }

  get notFound() {
    return this.status === 404;
  }
}

/**
 * Mealie couldn't be reached at all: connection refused, name not resolving,
 * or no answer before the timeout. Thrown by the client's fetch, so it never
 * wraps a bug in our own code.
 */
export class MealieUnavailableError extends Error {
  name = "MealieUnavailableError";
}

/** Mealie is down, overloaded or unreachable: worth trying again later. */
export const isMealieUnavailable = (err: unknown) =>
  err instanceof MealieUnavailableError ||
  (err instanceof MealieError && (err.status >= 500 || err.status === 429));

function describe(detail: unknown): string {
  if (typeof detail === "string") {
    return detail;
  }
  if (detail && typeof detail === "object" && "detail" in detail) {
    const d = (detail as { detail: unknown }).detail;
    return typeof d === "string" ? d : JSON.stringify(d);
  }
  return detail === undefined ? "" : JSON.stringify(detail);
}

export function createMealieClient(opts: {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const auth: Middleware = {
    onRequest({ request }) {
      request.headers.set("Authorization", `Bearer ${opts.token}`);
      return request;
    },
  };

  const client = createClient<paths>({
    baseUrl: opts.baseUrl.replace(/\/$/, ""),
    fetch: async (req) => {
      try {
        return await (opts.fetch ?? fetch)(
          new Request(req, { signal: AbortSignal.timeout(timeoutMs) })
        );
      } catch (err) {
        throw new MealieUnavailableError(
          `Mealie ${new URL(req.url).pathname} unreachable`,
          { cause: err }
        );
      }
    },
  });
  client.use(auth);
  return client;
}

/**
 * Unwraps an openapi-fetch result: returns `data`, or throws MealieError.
 * Usage: `const recipe = unwrap(await client.GET("/api/recipes/{slug}", ...))`.
 */
export function unwrap<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): T {
  const { data, error, response } = result;
  if (response.ok && data !== undefined) {
    return data;
  }
  const url = new URL(response.url || "http://mealie/unknown");
  throw new MealieError(response.status, url.pathname, error);
}

const shared = new Map<number, MealieClient>();

/**
 * Process-wide client configured from MEALIE_URL / MEALIE_API_TOKEN. The few
 * slow calls (creating a whole week's items) pass a longer timeout.
 */
export function mealie(timeoutMs = DEFAULT_TIMEOUT_MS): MealieClient {
  let client = shared.get(timeoutMs);
  if (!client) {
    const baseUrl = process.env.MEALIE_URL;
    const token = process.env.MEALIE_API_TOKEN;
    if (!baseUrl || !token) {
      throw new Error("MEALIE_URL and MEALIE_API_TOKEN must be set");
    }
    client = createMealieClient({ baseUrl, token, timeoutMs });
    shared.set(timeoutMs, client);
  }
  return client;
}

/**
 * The same, with a longer timeout for imports: Mealie fetches and scrapes the
 * page (or runs an AI model) before it answers.
 */
export const mealieImporter = (): MealieClient => mealie(IMPORT_TIMEOUT_MS);

/** Compares the running Mealie version with the one our types were generated from. */
export async function checkMealieVersion(client: MealieClient = mealie()) {
  const about = unwrap(await client.GET("/api/app/about"));
  return {
    server: about.version,
    schema: MEALIE_SCHEMA_VERSION,
    matches: about.version === MEALIE_SCHEMA_VERSION,
  };
}
