import type { JWT } from "next-auth/jwt";

import "server-only";

import { isDbUnreachable } from "./db/errors";

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
