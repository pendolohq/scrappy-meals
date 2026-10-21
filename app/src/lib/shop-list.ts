// The shop checklist's state, kept pure so it can be tested and shared by the
// page and the offline queue.

import { type Aisle, aisleOrder } from "@/server/domain/aisles";
import type { TickedAmount } from "@/server/domain/shopping";

export type ShopItemView = {
  /** The line's key for plan lines, a uuid for extras. */
  id: string;
  source: "plan" | "extra";
  /** The food, free-text line or extra's text. */
  text: string;
  /** "150 g", or "300 g more" when the plan outgrew a tick. */
  amount: string | null;
  /** The recipes, or "500 g in all" when partly bought. */
  detail: string | null;
  aisle: Aisle;
  checked: boolean;
  /** What a tick records: the line's current amounts. Empty for extras and free text. */
  amounts: TickedAmount[];
  position: number;
  /** Changed on this device but not yet saved. */
  pending?: boolean;
};

/**
 * A change made on this device, with its own `id`. Changes are only ever
 * appended and sent in order. Ticks set a value instead of toggling, an add
 * carries the id of the extra it creates, and a removal of an item that is
 * already gone succeeds, so a change sent twice (say, after a dropped
 * response) ends up the same.
 */
export type QueuedChange = { id: string } & (
  | {
      kind: "check";
      source: "plan" | "extra";
      itemId: string;
      checked: boolean;
      amounts: TickedAmount[];
    }
  | { kind: "add"; itemId: string; text: string }
  | { kind: "remove"; source: "plan" | "extra"; itemId: string }
);

/**
 * Takes a change that will never succeed off the queue; for an add, also the
 * later changes to the item it would have created.
 */
export function dropFailed(
  queue: QueuedChange[],
  failed: QueuedChange
): QueuedChange[] {
  return queue.filter(
    (c) =>
      c.id !== failed.id &&
      !(failed.kind === "add" && c.kind !== "add" && c.itemId === failed.itemId)
  );
}

/** What the list looks like once the queued changes land. */
export function applyQueue(
  items: ShopItemView[],
  queue: QueuedChange[]
): ShopItemView[] {
  let out = items.map((i) => ({ ...i }));
  for (const c of queue) {
    if (c.kind === "add") {
      // The page may already show an add whose change is still being cleared.
      if (out.some((i) => i.id === c.itemId)) {
        continue;
      }
      out.push({
        id: c.itemId,
        source: "extra",
        text: c.text,
        amount: null,
        detail: null,
        aisle: "Other",
        checked: false,
        amounts: [],
        position: Number.MAX_SAFE_INTEGER,
        pending: true,
      });
    } else if (c.kind === "remove") {
      out = out.filter((i) => i.id !== c.itemId);
    } else {
      out = out.map((i) =>
        i.id === c.itemId ? { ...i, checked: c.checked, pending: true } : i
      );
    }
  }
  return out;
}

/** What the server answered for one change. */
export type SendResult = { error?: string; retry?: true };

/**
 * Saves queued changes one at a time, oldest first. A change stays queued
 * until its request settles, then the queue is re-read, since the user may
 * have changed more in the meantime. A failed request or a retryable error
 * (the database down, signed out) stops the run and keeps the
 * queue; any other error drops that change and is reported.
 */
export async function flushQueue(io: {
  read: () => QueuedChange[];
  write: (queue: QueuedChange[]) => void;
  send: (change: QueuedChange) => Promise<SendResult>;
  onSaved: () => void;
  onRetry: (message: string) => void;
  onDrop: (message: string) => void;
}): Promise<void> {
  for (let change = io.read()[0]; change; change = io.read()[0]) {
    let result: SendResult;
    try {
      result = await io.send(change);
    } catch {
      return;
    }
    if (result.error && result.retry) {
      io.onRetry(result.error);
      return;
    }
    if (result.error) {
      io.onDrop(result.error);
      io.write(dropFailed(io.read(), change));
      continue;
    }
    io.onSaved();
    io.write(io.read().filter((c) => c.id !== change.id));
  }
}

export type ShopGroup = { label: string; items: ShopItemView[] };

/**
 * Unticked items grouped by aisle, in the order the shop is walked; ticked items in one list at the end.
 */
export function groupItems(items: ShopItemView[]): {
  groups: ShopGroup[];
  done: ShopItemView[];
} {
  const byPosition = (a: ShopItemView, b: ShopItemView) =>
    a.position - b.position || a.text.localeCompare(b.text);
  const groups = new Map<Aisle, ShopItemView[]>();
  for (const item of items.filter((i) => !i.checked)) {
    const aisle = item.aisle;
    groups.set(aisle, [...(groups.get(aisle) ?? []), item]);
  }
  return {
    groups: [...groups.entries()]
      .toSorted(([a], [b]) => aisleOrder(a) - aisleOrder(b))
      .map(([label, list]) => ({ label, items: list.toSorted(byPosition) })),
    done: items.filter((i) => i.checked).toSorted(byPosition),
  };
}
