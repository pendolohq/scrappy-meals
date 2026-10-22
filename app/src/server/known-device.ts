import { createHmac, timingSafeEqual } from "node:crypto";

import "server-only";

/**
 * A device a member has signed in on before. It lets them past the per-email
 * sign-in cap, so someone guessing their password from elsewhere can't lock
 * them out of a phone they use but whose session has ended.
 */
export const knownDeviceCookie = (secure: boolean) =>
  // __Host- keeps a sibling subdomain (recipes.<domain>) from replacing it.
  secure ? "__Host-known-device" : "known-device";
export const KNOWN_DEVICE_MAX_AGE = 365 * 24 * 60 * 60;

const MAX_ENTRIES = 5;
const SEP = ".";

/**
 * Who signed in. The session version is part of it, so changing a member's
 * password (or removing them) forgets every device they had.
 */
export type Member = { email: string; sessionVersion: number };

/** One entry per member: an HMAC, so it can't be made up or read. */
const tokenFor = (m: Member, secret: string) =>
  createHmac("sha256", secret)
    .update(`known-device:${m.sessionVersion}:${m.email}`)
    .digest("base64url")
    .slice(0, 22);

const entries = (cookie: string | undefined) =>
  (cookie ?? "").split(SEP).filter(Boolean);

export function isKnownDevice(
  cookie: string | undefined,
  member: Member,
  secret: string
): boolean {
  const want = Buffer.from(tokenFor(member, secret));
  return entries(cookie).some((entry) => {
    const got = Buffer.from(entry);
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

/** The cookie with this member added, most recent first. */
export function rememberDevice(
  cookie: string | undefined,
  member: Member,
  secret: string
): string {
  const token = tokenFor(member, secret);
  return [token, ...entries(cookie).filter((e) => e !== token)]
    .slice(0, MAX_ENTRIES)
    .join(SEP);
}
