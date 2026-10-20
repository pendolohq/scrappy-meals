// Light, dark or follow the system, chosen per device and kept in
// localStorage: it's about the screen, not the person, and it has to work on
// pages cached for offline use. Light is the default whatever the system
// says; dark applies only when someone picks it here.
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

const KEY = "theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";
// --background in globals.css, for the browser's toolbar.
export const BAR_COLOR = { light: "#f2e8cf", dark: "#131a14" } as const;

const listeners = new Set<() => void>();

const isDark = (theme: Theme) =>
  theme === "dark" || (theme === "system" && matchMedia(DARK_QUERY).matches);

/**
 * Runs inline in <head> before the first paint, so a dark page never flashes
 * light. Kept in step with applyTheme by hand: it can't import anything.
 */
export const themeScript = `try{var t=localStorage.getItem(${JSON.stringify(KEY)});if(t==="dark"||(t==="system"&&matchMedia(${JSON.stringify(DARK_QUERY)}).matches)){document.documentElement.dataset.theme="dark"}}catch(e){}`;

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    return THEMES.find((t) => t === stored) ?? "light";
  } catch {
    return "light";
  }
}

/** The server can't see localStorage, so it always renders the default. */
export const serverTheme = (): Theme => "light";

export function applyTheme(theme: Theme): void {
  const resolved = isDark(theme) ? "dark" : "light";
  document.documentElement.dataset.theme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", BAR_COLOR[resolved]);
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private mode or full storage: the choice lasts until the next load.
  }
  applyTheme(theme);
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Shaped for useSyncExternalStore. Also fires when the system switches
 * between light and dark, and when another tab changes the theme.
 */
export function subscribeTheme(listener: () => void): () => void {
  const media = matchMedia(DARK_QUERY);
  listeners.add(listener);
  media.addEventListener("change", listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", listener);
    window.removeEventListener("storage", listener);
  };
}
