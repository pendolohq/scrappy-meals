// The shop checklist's state, kept pure so it can be tested and shared by the
// page and the offline queue.

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
 * A change made on this device. Ticks set a value instead of toggling, so a
 * change replayed twice (say, after a dropped response) ends up the same.
 */
export type QueuedChange =
  | { kind: "check"; itemId: string; checked: boolean }
  | { kind: "add"; tempId: string; text: string }
  | { kind: "remove"; itemId: string };

export const TEMP_PREFIX = "local-";

const isTemp = (id: string) => id.startsWith(TEMP_PREFIX);

/** Adds a change to the queue, folding it into earlier changes to the same item. */
export function enqueue(
  queue: QueuedChange[],
  change: QueuedChange
): QueuedChange[] {
  if (change.kind === "add") {
    return [...queue, change];
  }
  const forItem = (c: QueuedChange) =>
    c.kind === "add" ? c.tempId === change.itemId : c.itemId === change.itemId;
  if (change.kind === "remove") {
    const rest = queue.filter((c) => !forItem(c));
    // An item that never reached Mealie just disappears.
    return isTemp(change.itemId) ? rest : [...rest, change];
  }
  // A later tick replaces an earlier one for the same item.
  return [...queue.filter((c) => !(c.kind === "check" && forItem(c))), change];
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

export type ShopGroup = { label: string; items: ShopItemView[] };

const OTHER = "Other";

/**
 * Unticked items grouped by Mealie label (the aisle), labels A–Z with
 * unlabelled items last; ticked items in one list at the end.
 */
export function groupItems(items: ShopItemView[]): {
  groups: ShopGroup[];
  done: ShopItemView[];
} {
  const byPosition = (a: ShopItemView, b: ShopItemView) =>
    a.position - b.position || a.text.localeCompare(b.text);
  const groups = new Map<string, ShopItemView[]>();
  for (const item of items.filter((i) => !i.checked)) {
    const label = item.label ?? OTHER;
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return {
    groups: [...groups.entries()]
      .map(([label, list]) => ({ label, items: list.toSorted(byPosition) }))
      .toSorted((a, b) =>
        a.label === OTHER
          ? 1
          : b.label === OTHER
            ? -1
            : a.label.localeCompare(b.label)
      ),
    done: items.filter((i) => i.checked).toSorted(byPosition),
  };
}
