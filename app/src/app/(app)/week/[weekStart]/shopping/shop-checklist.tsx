"use client";

import {
  type FormEvent,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { Check, ChevronDown, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, cardClass } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { cx } from "@/lib/cx";
import {
  applyQueue,
  flushQueue,
  groupItems,
  type QueuedChange,
  type SendResult,
  type ShopItemView,
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
      source: c.source,
      itemId: c.itemId,
      checked: c.checked,
      amounts: c.amounts,
    });
  }
  if (c.kind === "add") {
    return addShopItemAction({ weekStart, itemId: c.itemId, text: c.text });
  }
  return removeShopItemAction({
    weekStart,
    source: c.source,
    itemId: c.itemId,
    amounts: c.amounts,
  });
};

/** Weeks whose queue is being sent; one run per week at a time. */
const running = new Set<string>();

const flush = async (
  weekStart: string,
  setWaiting: (message: string | null) => void,
  setFailed: (update: (failed: string[]) => string[]) => void
) => {
  if (running.has(weekStart) || !navigator.onLine) {
    return;
  }
  running.add(weekStart);
  try {
    await flushQueue({
      read: () => readQueue(weekStart),
      write: (queue) => writeQueue(weekStart, queue),
      send: (c) => send(weekStart, c),
      onSaved: () => setWaiting(null),
      onRetry: setWaiting,
      onDrop: (message) => setFailed((failed) => [...failed, message]),
    });
  } finally {
    running.delete(weekStart);
  }
};

export const ShopChecklist = ({
  weekStart,
  items,
}: {
  weekStart: string;
  items: ShopItemView[];
}) => {
  const queue = useSyncExternalStore(
    subscribeQueue,
    () => readQueue(weekStart),
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
    const run = () => void flush(weekStart, setWaiting, setFailed);
    const retry = () => {
      if (readQueue(weekStart).length > 0) {
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
  }, [weekStart]);

  const change = (c: QueuedChange) => {
    writeQueue(weekStart, [...readQueue(weekStart), c]);
    void flush(weekStart, setWaiting, setFailed);
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
      itemId: crypto.randomUUID(),
      text: value,
    });
    setText("");
  };

  const shown = applyQueue(items, queue);
  const { groups, done } = groupItems(shown);

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          placeholder="Add an item, e.g. coffee"
          aria-label="Add an item"
          className="min-w-0 flex-1"
        />
        <Button type="submit" className="shrink-0">
          <Plus className="size-4" aria-hidden />
          Add
        </Button>
      </form>

      {waiting && (
        <p
          role="alert"
          className="rounded-control bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {waiting}
        </p>
      )}
      {failed.length > 0 && (
        <div
          role="alert"
          className="space-y-1 rounded-control bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {failed.map((message, i) => (
            // oxlint-disable-next-line react/no-array-index-key -- messages repeat and never reorder
            <p key={i}>Not saved: {message}</p>
          ))}
          <button
            type="button"
            onClick={() => setFailed([])}
            className="min-h-tap text-xs text-muted underline"
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

      {shown.length === 0 && (
        <Card className="py-10 text-center">
          <p className="font-serif text-heading font-semibold">
            Nothing to buy yet
          </p>
          <p className="mt-1 text-sm text-muted">
            Nothing on the list for this week.
          </p>
        </Card>
      )}
      {shown.length > 0 && groups.length === 0 && (
        <Card className="py-8 text-center">
          <p className="font-serif text-heading font-semibold">
            Everything&apos;s in the basket.
          </p>
        </Card>
      )}
      {groups.map((g) => (
        <Card as="section" key={g.label} className="py-2 sm:py-3">
          <h2 className="pt-2 text-xs font-semibold tracking-wider text-muted uppercase">
            {g.label}
          </h2>
          <ul className="divide-y divide-border/70">
            {g.items.map((item) => (
              <ShopRow key={item.id} item={item} onChange={change} />
            ))}
          </ul>
        </Card>
      ))}

      {done.length > 0 && (
        <details className={cx(cardClass(), "group py-2 sm:py-3")}>
          <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden">
            Done ({done.length})
            <ChevronDown
              className="size-4 text-muted transition group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <ul className="divide-y divide-border/70">
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
    // Removing can't be undone (a plan line only comes back when the plan
    // needs more of it), so it asks first.
    if (window.confirm(`Remove "${item.text}" from the list?`)) {
      onChange({
        id: crypto.randomUUID(),
        kind: "remove",
        source: item.source,
        itemId: item.id,
        amounts: item.amounts,
      });
    }
  };
  return (
    <li className="flex items-center gap-2" data-testid="shop-item">
      <label className="flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 py-2">
        {/* A round check like a paper list; still a real checkbox underneath. */}
        <span className="relative flex size-6 shrink-0 items-center justify-center">
          <input
            type="checkbox"
            checked={item.checked}
            onChange={(e) =>
              onChange({
                id: crypto.randomUUID(),
                kind: "check",
                source: item.source,
                itemId: item.id,
                checked: e.target.checked,
                amounts: item.amounts,
              })
            }
            className="peer size-6 cursor-pointer appearance-none rounded-full border-2 border-border-strong bg-card transition checked:border-accent checked:bg-accent"
          />
          <Check
            className="pointer-events-none absolute size-3.5 text-accent-foreground opacity-0 peer-checked:opacity-100"
            strokeWidth={3}
            aria-hidden
          />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cx(
              "block",
              item.checked ? "text-muted line-through" : "font-medium"
            )}
          >
            {item.text}
          </span>
          {item.detail && (
            <span className="mt-0.5 block truncate text-xs text-muted">
              {item.detail}
            </span>
          )}
        </span>
        {item.amount && (
          <span
            className={cx(
              "shrink-0 text-right font-semibold tabular-nums",
              item.checked ? "text-muted" : "text-accent-ink"
            )}
            data-testid="qty"
          >
            {item.amount}
          </span>
        )}
        {item.pending && (
          <span
            className="size-2 shrink-0 rounded-full bg-highlight"
            title="Not saved yet"
          >
            <span className="sr-only">Not saved yet</span>
          </span>
        )}
      </label>
      <IconButton
        label={`Remove ${item.text}`}
        onClick={remove}
        className="-mr-2"
      >
        <X className="size-4" aria-hidden />
      </IconButton>
    </li>
  );
};
