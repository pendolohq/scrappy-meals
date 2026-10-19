import "server-only";

// Node network errors and Postgres "can't connect / shutting down" codes.
const UNREACHABLE = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "57P01",
  "57P02",
  "57P03",
]);

/** Postgres can't be reached. Drizzle wraps the driver's error, so follow `cause`. */
export function isDbUnreachable(err: unknown): boolean {
  for (let e = err; e instanceof Error; e = e.cause) {
    const code = (e as { code?: unknown }).code;
    if (
      typeof code === "string" &&
      (UNREACHABLE.has(code) || code.startsWith("08"))
    ) {
      return true;
    }
  }
  return false;
}
