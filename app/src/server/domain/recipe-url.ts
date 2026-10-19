const MAX_LENGTH = 2048;

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
  // IPv6 literals ("[::1]") have no dot and are refused above; anything else
  // is already punycode, so only letters, digits and hyphens may remain.
  if (!/^[a-z0-9.-]+$/.test(url.hostname)) {
    return {
      ok: false,
      error: "That address has characters a host can't have.",
    };
  }
  url.hash = "";
  // Non-ASCII characters grow when percent-encoded, so check the result too.
  if (url.href.length > MAX_LENGTH) {
    return { ok: false, error: "That address is too long." };
  }
  return { ok: true, url: url.href };
}
