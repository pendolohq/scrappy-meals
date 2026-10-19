// Queued shop-list changes per Mealie list, kept in localStorage so they
// survive a reload or a dead phone signal. Shaped for useSyncExternalStore.
import type { QueuedChange } from "./shop-list";

const EMPTY: QueuedChange[] = [];
const cache = new Map<string, QueuedChange[]>();
const listeners = new Set<() => void>();

const storageKey = (listId: string) => `shop-queue:${listId}`;

function load(listId: string): QueuedChange[] {
  try {
    const raw = localStorage.getItem(storageKey(listId));
    return raw ? JSON.parse(raw) : EMPTY;
  } catch {
    return EMPTY;
  }
}

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
      localStorage.removeItem(storageKey(listId));
    } else {
      localStorage.setItem(storageKey(listId), JSON.stringify(queue));
    }
  } catch {
    // Private mode or full storage: changes still save while online.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
