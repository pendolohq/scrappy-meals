const MAX_LENGTH = 2048;

const SOCIAL_HOSTS = ["instagram.com", "facebook.com", "fb.watch"];

/**
 * Whether the address is a post on Instagram or Facebook (or a subdomain such
 * as m.facebook.com). Takes any text, so a form can call it on every keystroke.
 */
export function isSocialPostUrl(input: string): boolean {
  let host: string;
  try {
    host = new URL(input.trim()).hostname;
  } catch {
    return false;
  }
  return SOCIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

// Share links add these to every post, so keeping them would import one post
// twice. The rest of the query stays: Facebook often carries the post's
// identity there (watch/?v=, story.php?story_fbid=&id=, photo.php?fbid=).
const TRACKING_PARAMS = new Set([
  "igsh",
  "igshid",
  "mibextid",
  "rdid",
  "fbclid",
  "share_url",
  "sfnsn",
]);

const isTracking = (name: string) =>
  TRACKING_PARAMS.has(name) ||
  name.startsWith("utm_") ||
  // Facebook's click-tracking blobs: __cft__[0], __tn__.
  name.startsWith("__cft__") ||
  name.startsWith("__tn__");

function stripTracking(url: URL) {
  for (const name of new Set(url.searchParams.keys())) {
    if (isTracking(name)) {
      url.searchParams.delete(name);
    }
  }
  // Sorted so the same post compares equal whatever order the link had.
  url.searchParams.sort();
}

export type RecipeUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Checks and normalises an address typed into the import form. The result is
 * what is stored as the recipe's source URL and later compared with, so equal
 * pages must come out equal (no fragment, canonical `href`).
 */
export function normaliseRecipeUrl(input: string): RecipeUrlResult {
  const text = input.trim();
  if (text === "") {
    return { ok: false, error: "Enter the address of a recipe page." };
  }
  if (text.length > MAX_LENGTH) {
    return { ok: false, error: "That address is too long." };
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return {
      ok: false,
      error: "That doesn't look like a web address. Start it with https://",
    };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http:// and https:// addresses work." };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Remove the username and password." };
  }
  // Single-label hosts (localhost, Compose service names) are never public
  // pages; a trailing dot ("localhost.") must not count as a second label.
  const labels = url.hostname.split(".");
  if (labels.length < 2 || labels.some((l) => l === "")) {
    return { ok: false, error: "That address isn't a public web page." };
  }
  // An IPv4 literal is a server, not a recipe site, and usually an internal
  // one. (WHATWG parsing turns "0x7f.1" and the like into dotted decimal.)
  if (/^[\d.]+$/.test(url.hostname)) {
    return { ok: false, error: "That address isn't a public web page." };
  }
  // IPv6 literals ("[::1]") have no dot and are refused above; anything else
  // is already punycode, so only letters, digits and hyphens may remain.
  if (!/^[a-z0-9.-]+$/.test(url.hostname)) {
    return {
      ok: false,
      error: "That address has characters a host can't have.",
    };
  }
  url.hash = "";
  if (isSocialPostUrl(url.href)) {
    stripTracking(url);
  }
  // Non-ASCII characters grow when percent-encoded, so check the result too.
  if (url.href.length > MAX_LENGTH) {
    return { ok: false, error: "That address is too long." };
  }
  return { ok: true, url: url.href };
}
