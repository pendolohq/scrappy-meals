// Queued shop-list changes per week, kept in localStorage so they
// survive a reload or a dead phone signal. Shaped for useSyncExternalStore.
import type { QueuedChange } from "./shop-list";

const EMPTY: QueuedChange[] = [];
const PREFIX = "shop-queue:";
const cache = new Map<string, QueuedChange[]>();
const listeners = new Set<() => void>();

function load(key: string): QueuedChange[] {
  try {
    return JSON.parse(localStorage.getItem(PREFIX + key) ?? "[]");
  } catch {
    return EMPTY;
  }
}

const notify = () => {
  for (const listener of listeners) {
    listener();
  }
};

export function readQueue(key: string): QueuedChange[] {
  let queue = cache.get(key);
  if (!queue) {
    queue = load(key);
    cache.set(key, queue);
  }
  return queue;
}

/** On the server nothing is queued; the browser fills it in after hydration. */
export const serverQueue = (): QueuedChange[] => EMPTY;

export function writeQueue(key: string, queue: QueuedChange[]): void {
  cache.set(key, queue);
  try {
    if (queue.length === 0) {
      localStorage.removeItem(PREFIX + key);
    } else {
      localStorage.setItem(PREFIX + key, JSON.stringify(queue));
    }
  } catch {
    // Private mode or full storage: changes still save while online.
  }
  notify();
}

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
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
