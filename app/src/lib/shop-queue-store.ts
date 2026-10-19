// Queued shop-list changes per Mealie list, kept in localStorage so they
// survive a reload or a dead phone signal. Shaped for useSyncExternalStore.
import type { QueuedChange } from "./shop-list";

const EMPTY: QueuedChange[] = [];
const PREFIX = "shop-queue:";
const cache = new Map<string, QueuedChange[]>();
const listeners = new Set<() => void>();

const isChange = (c: unknown): c is QueuedChange =>
  typeof c === "object" &&
  c !== null &&
  typeof (c as QueuedChange).id === "string" &&
  ["check", "add", "remove"].includes((c as QueuedChange).kind);

// Anything unreadable (old format, hand-edited) is dropped rather than
// allowed to break the page.
function load(listId: string): QueuedChange[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(PREFIX + listId) ?? "[]"
    );
    return Array.isArray(parsed) && parsed.every(isChange) ? parsed : EMPTY;
  } catch {
    return EMPTY;
  }
}

const notify = () => {
  for (const listener of listeners) {
    listener();
  }
};

export function readQueue(listId: string): QueuedChange[] {
  let queue = cache.get(listId);
  if (!queue) {
    queue = load(listId);
    cache.set(listId, queue);
  }
  return queue;
}

/** On the server nothing is queued; the browser fills it in after hydration. */
export const serverQueue = (): QueuedChange[] => EMPTY;

export function writeQueue(listId: string, queue: QueuedChange[]): void {
  cache.set(listId, queue);
  try {
    if (queue.length === 0) {
      localStorage.removeItem(PREFIX + listId);
    } else {
      localStorage.setItem(PREFIX + listId, JSON.stringify(queue));
    }
  } catch {
    // Private mode or full storage: changes still save while online.
  }
  notify();
}

// Another tab (or the installed app next to a browser tab) changed a queue.
const onStorage = (e: StorageEvent) => {
  if (e.key === null || e.key.startsWith(PREFIX)) {
    cache.clear();
    notify();
  }
};

export function subscribeQueue(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage);
    }
  };
}

/** Called on sign-out: queued item names stay off a shared device. */
export function clearAllQueues(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Nothing stored, or no access to storage.
  }
  cache.clear();
}
