// The shop checklist's state, kept pure so it can be tested and shared by the
// page and the offline queue.

import { type Aisle, aisleOf, aisleOrder } from "@/server/domain/aisles";

export type ShopItemView = {
  id: string;
  text: string;
  checked: boolean;
  label: string | null;
  position: number;
  /** Changed on this device but not yet saved to Mealie. */
  pending?: boolean;
};

/**
 * A change made on this device, with its own `id`. Changes are only ever
 * appended and sent in order. Ticks set a value instead of toggling and a
 * removal of an item that is already gone succeeds, so a change sent twice
 * (say, after a dropped response) ends up the same.
 */
export type QueuedChange = { id: string } & (
  | { kind: "check"; itemId: string; checked: boolean }
  | { kind: "add"; tempId: string; text: string }
  | { kind: "remove"; itemId: string }
);

export const TEMP_PREFIX = "local-";

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
      !(failed.kind === "add" && c.kind !== "add" && c.itemId === failed.tempId)
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
      out.push({
        id: c.tempId,
        text: c.text,
        checked: false,
        label: null,
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

/** After a queued add is saved, later changes to it use Mealie's id. */
export function replaceTempId(
  queue: QueuedChange[],
  tempId: string,
  id: string
): QueuedChange[] {
  return queue.map((c) =>
    c.kind !== "add" && c.itemId === tempId ? { ...c, itemId: id } : c
  );
}

/** What the server answered for one change. */
export type SendResult = {
  error?: string;
  retry?: true;
  item?: { id: string };
};

/**
 * Saves queued changes one at a time, oldest first. A change stays queued
 * until its request settles, then the queue is re-read, since the user may
 * have changed more in the meantime. A failed request or a retryable error
 * (Mealie or the database down, signed out) stops the run and keeps the
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
    const rest = io.read().filter((c) => c.id !== change.id);
    io.write(
      change.kind === "add" && result.item
        ? replaceTempId(rest, change.tempId, result.item.id)
        : rest
    );
  }
}

export type ShopGroup = { label: string; items: ShopItemView[] };

/**
 * Unticked items grouped by aisle (from their Mealie label), in the order the
 * shop is walked; ticked items in one list at the end.
 */
export function groupItems(items: ShopItemView[]): {
  groups: ShopGroup[];
  done: ShopItemView[];
} {
  const byPosition = (a: ShopItemView, b: ShopItemView) =>
    a.position - b.position || a.text.localeCompare(b.text);
  const groups = new Map<Aisle, ShopItemView[]>();
  for (const item of items.filter((i) => !i.checked)) {
    const aisle = aisleOf(item.label);
    groups.set(aisle, [...(groups.get(aisle) ?? []), item]);
  }
  return {
    groups: [...groups.entries()]
      .toSorted(([a], [b]) => aisleOrder(a) - aisleOrder(b))
      .map(([label, list]) => ({ label, items: list.toSorted(byPosition) })),
    done: items.filter((i) => i.checked).toSorted(byPosition),
  };
}
