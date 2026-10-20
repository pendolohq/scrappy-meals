"use client";

import {
  type FormEvent,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import {
  applyQueue,
  flushQueue,
  groupItems,
  type QueuedChange,
  type SendResult,
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
} from "./checklist-actions";

const RETRY_MS = 10_000;

const send = (weekStart: string, c: QueuedChange): Promise<SendResult> => {
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

/** Lists whose queue is being sent; one run per list at a time. */
const running = new Set<string>();

const flush = async (
  listId: string,
  weekStart: string,
  setWaiting: (message: string | null) => void,
  setFailed: (update: (failed: string[]) => string[]) => void
) => {
  if (running.has(listId) || !navigator.onLine) {
    return;
  }
  running.add(listId);
  try {
    await flushQueue({
      read: () => readQueue(listId),
      write: (queue) => writeQueue(listId, queue),
      // The action's response also carries the refreshed list.
      send: (c) => send(weekStart, c),
      onSaved: () => setWaiting(null),
      onRetry: setWaiting,
      onDrop: (message) => setFailed((failed) => [...failed, message]),
    });
  } finally {
    running.delete(listId);
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
  // Why the queue is waiting (cleared once a change saves), and changes that
  // were dropped for good (kept until dismissed, so they can't flash past).
  const [waiting, setWaiting] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [text, setText] = useState("");

  // Saves what an earlier visit left queued, and retries when the device
  // comes back online or every few seconds while something is waiting.
  useEffect(() => {
    const run = () => void flush(listId, weekStart, setWaiting, setFailed);
    const retry = () => {
      if (readQueue(listId).length > 0) {
        run();
      }
    };
    run();
    const timer = setInterval(retry, RETRY_MS);
    window.addEventListener("online", run);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", run);
    };
  }, [listId, weekStart]);

  const change = (c: QueuedChange) => {
    writeQueue(listId, [...readQueue(listId), c]);
    void flush(listId, weekStart, setWaiting, setFailed);
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
          className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-foreground"
        >
          Add
        </button>
      </form>

      {waiting && (
        <p role="alert" className="text-sm text-danger">
          {waiting}
        </p>
      )}
      {failed.length > 0 && (
        <div role="alert" className="space-y-1 text-sm text-danger">
          {failed.map((message, i) => (
            // oxlint-disable-next-line react/no-array-index-key -- messages repeat and never reorder
            <p key={i}>Not saved: {message}</p>
          ))}
          <button
            type="button"
            onClick={() => setFailed([])}
            className="text-xs text-muted underline"
          >
            Dismiss
          </button>
        </div>
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
