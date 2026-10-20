// Whether and how this browser can install the app, shaped for
// useSyncExternalStore. Chrome and Edge (Android, desktop) offer a prompt we
// can open from a button; iOS never prompts, so we explain Share → Add to Home
// Screen; anything else only has its own browser menu.
export type InstallState = "installed" | "prompt" | "ios" | "other";

type InstallPromptEvent = Event & { prompt: () => Promise<unknown> };

const DISMISSED_KEY = "install-hint-dismissed";
let deferred: InstallPromptEvent | null = null;
let installed = false;
let dismissed: boolean | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) {
    listener();
  }
};

const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches ||
  (navigator as { standalone?: boolean }).standalone === true;

// iPadOS reports itself as a Mac; a touch screen gives it away.
const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/**
 * Catches the browser's install prompt. It fires once, early, often before
 * the component that shows the button has mounted, so this runs from the
 * root layout.
 */
export function listenForInstall(): () => void {
  const onPrompt = (event: Event) => {
    event.preventDefault(); // keep Chrome's own mini-infobar out of the way
    deferred = event as InstallPromptEvent;
    notify();
  };
  const onInstalled = () => {
    installed = true;
    deferred = null;
    notify();
  };
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

export function readInstall(): InstallState {
  if (installed || isStandalone()) {
    return "installed";
  }
  if (deferred) {
    return "prompt";
  }
  return isIos() ? "ios" : "other";
}

/** The server can't tell, so it renders nothing install-related. */
export const serverInstall = (): InstallState => "installed";

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Opens the browser's install dialog; the prompt can be used only once. */
export async function promptInstall(): Promise<void> {
  const event = deferred;
  deferred = null;
  notify();
  await event?.prompt();
}

export function readDismissed(): boolean {
  if (dismissed === null) {
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) !== null;
    } catch {
      dismissed = false;
    }
  }
  return dismissed;
}

/** Hidden until it's dismissed, so the server renders it as dismissed. */
export const serverDismissed = (): boolean => true;

/** The banner shows once per device; Settings keeps the full hint. */
export function dismissInstallHint(): void {
  dismissed = true;
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Private mode or full storage: hidden until the next load.
  }
  notify();
}
