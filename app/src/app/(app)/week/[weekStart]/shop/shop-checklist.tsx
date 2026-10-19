"use client";

import {
  type FormEvent,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";

import {
  applyQueue,
  enqueue,
  groupItems,
  type QueuedChange,
  replaceTempId,
  type ShopItemView,
  TEMP_PREFIX,
} from "@/lib/shop-list";
import {
  readQueue,
  serverQueue,
  subscribeQueue,
  writeQueue,
} from "@/lib/shop-queue-store";

import {
  addShopItemAction,
  checkShopItemAction,
  removeShopItemAction,
} from "./actions";

type Result = { error?: string; item?: { id: string } };

type FlushHooks = {
  onError: (message: string) => void;
  onSaved: (change: QueuedChange) => void;
  onDone: () => void;
};

const send = (weekStart: string, c: QueuedChange): Promise<Result> => {
  if (c.kind === "check") {
    return checkShopItemAction({
      weekStart,
      itemId: c.itemId,
      checked: c.checked,
    });
  }
  if (c.kind === "add") {
    return addShopItemAction({ weekStart, text: c.text });
  }
  return removeShopItemAction({ weekStart, itemId: c.itemId });
};

type Settled = { base: ShopItemView[]; changes: QueuedChange[] };

/** Callbacks for one flush; `items` is the list the saved changes apply to. */
const flushHooks = (
  items: ShopItemView[],
  setSettled: (update: (s: Settled) => Settled) => void,
  setError: (message: string) => void,
  refresh: () => void
): FlushHooks => ({
  onError: setError,
  onSaved: (change) =>
    setSettled((s) => ({
      base: items,
      changes: s.base === items ? [...s.changes, change] : [change],
    })),
  onDone: refresh,
});

const flushing = new Set<string>();

/**
 * Saves queued changes in order. A network failure stops the run and keeps
 * the rest queued for the next time the device is online.
 */
const flush = async (listId: string, weekStart: string, hooks: FlushHooks) => {
  if (flushing.has(listId) || !navigator.onLine) {
    return;
  }
  flushing.add(listId);
  let saved = false;
  try {
    while (readQueue(listId).length > 0) {
      const [change, ...rest] = readQueue(listId);
      let result: Result;
      try {
        result = await send(weekStart, change);
      } catch {
        break;
      }
      if (result.error) {
        hooks.onError(result.error);
        writeQueue(listId, rest);
        continue;
      }
      if (change.kind === "add" && result.item) {
        writeQueue(listId, replaceTempId(rest, change.tempId, result.item.id));
        hooks.onSaved({ ...change, tempId: result.item.id });
      } else {
        writeQueue(listId, rest);
        hooks.onSaved(change);
      }
      saved = true;
    }
  } finally {
    flushing.delete(listId);
  }
  if (saved) {
    hooks.onDone();
  }
};

export const ShopChecklist = ({
  weekStart,
  listId,
  items,
}: {
  weekStart: string;
  listId: string;
  items: ShopItemView[];
}) => {
  const router = useRouter();
  const queue = useSyncExternalStore(
    subscribeQueue,
    () => readQueue(listId),
    serverQueue
  );
  // Saved changes, shown on top of `items` until a refreshed list (a new
  // `items` from the server) arrives with them already in it.
  const [settled, setSettled] = useState<Settled>({
    base: items,
    changes: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");

  // Saves what an earlier visit left queued, and retries when back online.
  useEffect(() => {
    const hooks = flushHooks(items, setSettled, setError, () =>
      router.refresh()
    );
    const run = () => void flush(listId, weekStart, hooks);
    run();
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
  }, [listId, weekStart, items, router]);

  const change = (c: QueuedChange) => {
    setError(null);
    writeQueue(listId, enqueue(readQueue(listId), c));
    void flush(
      listId,
      weekStart,
      flushHooks(items, setSettled, setError, () => router.refresh())
    );
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) {
      return;
    }
    change({
      kind: "add",
      tempId: `${TEMP_PREFIX}${crypto.randomUUID()}`,
      text: value,
    });
    setText("");
  };

  const saved = settled.base === items ? settled.changes : [];
  const shown = applyQueue(
    applyQueue(items, saved).map((i) => ({ ...i, pending: false })),
    queue
  );
  const { groups, done } = groupItems(shown);

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          placeholder="Add an item, e.g. coffee"
          aria-label="Add an item"
          className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2"
        />
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 font-medium text-white dark:text-stone-900"
        >
          Add
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {queue.length > 0 && (
        <p className="text-xs text-muted" data-testid="pending">
          {queue.length} change{queue.length === 1 ? "" : "s"} not saved yet;
          they save when you&apos;re back online.
        </p>
      )}

      {groups.length === 0 && (
        <p className="text-sm text-muted">Everything&apos;s in the basket.</p>
      )}
      {groups.map((g) => (
        <section
          key={g.label}
          className="rounded-xl border border-border bg-card p-3"
        >
          <h2 className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">
            {g.label}
          </h2>
          <ul className="divide-y divide-border">
            {g.items.map((item) => (
              <ShopRow key={item.id} item={item} onChange={change} />
            ))}
          </ul>
        </section>
      ))}

      {done.length > 0 && (
        <details className="rounded-xl border border-border bg-card p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Done ({done.length})
          </summary>
          <ul className="mt-1 divide-y divide-border">
            {done.map((item) => (
              <ShopRow key={item.id} item={item} onChange={change} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

const ShopRow = ({
  item,
  onChange,
}: {
  item: ShopItemView;
  onChange: (c: QueuedChange) => void;
}) => (
  <li className="flex items-center gap-2" data-testid="shop-item">
    <label className="flex min-h-11 flex-1 items-center gap-3 py-1">
      <input
        type="checkbox"
        checked={item.checked}
        onChange={(e) =>
          onChange({
            kind: "check",
            itemId: item.id,
            checked: e.target.checked,
          })
        }
        className="size-5 accent-accent"
      />
      <span className={item.checked ? "text-muted line-through" : ""}>
        {item.text}
      </span>
      {item.pending && (
        <span className="text-xs text-muted" title="Not saved yet">
          •
        </span>
      )}
    </label>
    <button
      type="button"
      onClick={() => onChange({ kind: "remove", itemId: item.id })}
      aria-label={`Remove ${item.text}`}
      className="size-9 rounded-full text-muted"
    >
      ×
    </button>
  </li>
);
