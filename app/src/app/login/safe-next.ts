/**
 * Where to go after signing in: only a path on this site, anything else falls
 * back to the home page. Browsers read a backslash as "/", so "/\evil.com"
 * would be "//evil.com", another site.
 */
export function safeNext(next: FormDataEntryValue | null): string {
  return typeof next === "string" &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    // oxlint-disable-next-line no-control-regex -- control characters are what it rejects
    !/[\\\u0000-\u001f]/.test(next)
    ? next
    : "/";
}
