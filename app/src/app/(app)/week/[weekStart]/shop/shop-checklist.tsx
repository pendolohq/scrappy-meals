"use client";

import {
  type FormEvent,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import {
  applyQueue,
  dropFailed,
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

type Result = { error?: string; retry?: true; item?: { id: string } };

const RETRY_MS = 10_000;

const send = (weekStart: string, c: QueuedChange): Promise<Result> => {
  if (c.kind === "check") {
    return checkShopItemAction({
      weekStart,
      itemId: c.itemId,
      checked: c.checked,
    });
  }
  if (c.kind === "add") {
    return addShopItemAction({ weekStart, text: c.text, clientId: c.tempId });
  }
  return removeShopItemAction({ weekStart, itemId: c.itemId });
};

/** The change whose request is out, per list; enqueue leaves it alone. */
const inFlight = new Map<string, string>();

/**
 * Saves queued changes one at a time, oldest first. Each change stays in the
 * queue until its request settles; the queue is then re-read, since the user
 * may have changed more in the meantime. A network failure or a retryable
 * error (Mealie down, signed out) stops the run and keeps the queue.
 */
const flush = async (
  listId: string,
  weekStart: string,
  setError: (message: string | null) => void
) => {
  if (inFlight.has(listId) || !navigator.onLine) {
    return;
  }
  try {
    for (;;) {
      const change = readQueue(listId)[0];
      if (!change) {
        break;
      }
      inFlight.set(listId, change.id);
      let result: Result;
      try {
        // The action's response also carries the refreshed list.
        result = await send(weekStart, change);
      } catch {
        break;
      }
      if (result.error) {
        setError(result.error);
        if (result.retry) {
          break;
        }
        writeQueue(listId, dropFailed(readQueue(listId), change));
        continue;
      }
      setError(null);
      const rest = readQueue(listId).filter((c) => c.id !== change.id);
      writeQueue(
        listId,
        change.kind === "add" && result.item
          ? replaceTempId(rest, change.tempId, result.item.id)
          : rest
      );
    }
  } finally {
    inFlight.delete(listId);
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
  const queue = useSyncExternalStore(
    subscribeQueue,
    () => readQueue(listId),
    serverQueue
  );
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");

  // Saves what an earlier visit (or another tab) left queued, and retries
  // when the device comes back online, regains focus, or every few seconds
  // while something is waiting.
  useEffect(() => {
    const run = () => void flush(listId, weekStart, setError);
    const retry = () => {
      if (readQueue(listId).length > 0) {
        run();
      }
    };
    run();
    const timer = setInterval(retry, RETRY_MS);
    window.addEventListener("online", run);
    window.addEventListener("focus", retry);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", run);
      window.removeEventListener("focus", retry);
    };
  }, [listId, weekStart]);

  const change = (c: QueuedChange) => {
    writeQueue(
      listId,
      enqueue(readQueue(listId), c, inFlight.get(listId) ?? null)
    );
    void flush(listId, weekStart, setError);
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) {
      return;
    }
    change({
      id: crypto.randomUUID(),
      kind: "add",
      tempId: `${TEMP_PREFIX}${crypto.randomUUID()}`,
      text: value,
    });
    setText("");
  };

  const { groups, done } = groupItems(applyQueue(items, queue));

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
}) => {
  const remove = () => {
    // Removing deletes the line in Mealie, so it asks first.
    if (window.confirm(`Remove "${item.text}" from the list?`)) {
      onChange({ id: crypto.randomUUID(), kind: "remove", itemId: item.id });
    }
  };
  return (
    <li className="flex items-center gap-2" data-testid="shop-item">
      <label className="flex min-h-11 flex-1 items-center gap-3 py-1">
        <input
          type="checkbox"
          checked={item.checked}
          onChange={(e) =>
            onChange({
              id: crypto.randomUUID(),
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
        onClick={remove}
        aria-label={`Remove ${item.text}`}
        className="size-11 shrink-0 rounded-full text-muted"
      >
        ×
      </button>
    </li>
  );
};
