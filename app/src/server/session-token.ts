import type { JWT } from "next-auth/jwt";

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
function isDbUnreachable(err: unknown): boolean {
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

/**
 * Runs on every request after sign-in: drops the session if the user was
 * removed or changed their password. If Postgres can't be reached (it's
 * restarting), the token is kept: returning null would delete the cookie and
 * sign everyone out for good. Every page and action needs the database too,
 * so a revoked session gets nothing but Mealie's recipe search and images
 * until Postgres is back. Any other error still fails the request, so a broken
 * query can't quietly turn revocation off.
 */
export async function refreshToken(
  token: JWT,
  findUser: (
    id: string
  ) => Promise<
    { name: string; email: string; sessionVersion: number } | undefined
  >
): Promise<JWT | null> {
  if (!token.uid) {
    return null;
  }
  let current;
  try {
    current = await findUser(token.uid);
  } catch (err) {
    if (!isDbUnreachable(err)) {
      throw err;
    }
    console.error("database unreachable; keeping the session", err);
    return token;
  }
  if (!current || current.sessionVersion !== token.sv) {
    return null;
  }
  return { ...token, name: current.name, email: current.email };
}
