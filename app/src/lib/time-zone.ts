// "Today" is the date where the device is, not where the server is. The
// browser keeps its zone in this cookie (TimeZoneSync), which Server
// Components and actions can read; until it arrives, or when it doesn't name
// a real zone, the server's TZ decides.
export const TIME_ZONE_COOKIE = "tz";

const ONE_YEAR = 60 * 60 * 24 * 365;

export const deviceTimeZone = (): string | undefined =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;

const readCookie = (): string | undefined => {
  const prefix = `${TIME_ZONE_COOKIE}=`;
  const entry = document.cookie.split("; ").find((c) => c.startsWith(prefix));
  return entry && decodeURIComponent(entry.slice(prefix.length));
};

/** Stores the device's zone; true when it changed, so the page is stale. */
export function saveTimeZone(): boolean {
  const zone = deviceTimeZone();
  if (!zone || readCookie() === zone) {
    return false;
  }
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=${ONE_YEAR}; samesite=lax${secure}`;
  return true;
}
