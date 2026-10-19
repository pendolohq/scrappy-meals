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
  // Single-label hosts (localhost, Compose service names) are never public pages.
  if (!url.hostname.includes(".")) {
    return { ok: false, error: "That address isn't a public web page." };
  }
  url.hash = "";
  return { ok: true, url: url.href };
}
