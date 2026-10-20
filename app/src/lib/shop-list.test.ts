import { describe, expect, it, vi } from "vitest";

import {
  applyQueue,
  dropFailed,
  flushQueue,
  groupItems,
  type QueuedChange,
  replaceTempId,
  type SendResult,
  type ShopItemView,
} from "./shop-list";

const item = (id: string, over: Partial<ShopItemView> = {}): ShopItemView => ({
  id,
  text: id,
  checked: false,
  label: null,
  position: 0,
  ...over,
});

let n = 0;
const check = (itemId: string, checked = true): QueuedChange => ({
  id: `c${++n}`,
  kind: "check",
  itemId,
  checked,
});
const add = (tempId: string, text = tempId): QueuedChange => ({
  id: `c${++n}`,
  kind: "add",
  tempId,
  text,
});
const remove = (itemId: string): QueuedChange => ({
  id: `c${++n}`,
  kind: "remove",
  itemId,
});

describe("dropFailed", () => {
  it("drops only the failed change", () => {
    const a = check("a");
    const b = check("b");
    expect(dropFailed([a, b], a)).toEqual([b]);
  });

  it("drops later changes to an item whose add failed", () => {
    const failed = add("local-1");
    const tick = check("local-1");
    const other = check("b");
    expect(dropFailed([failed, tick, other], failed)).toEqual([other]);
  });
});

describe("flushQueue", () => {
  /** A queue in memory and a server that answers from `answer`. */
  const setup = (
    queue: QueuedChange[],
    answer: (c: QueuedChange) => Promise<SendResult>
  ) => {
    const state = { queue, sent: [] as QueuedChange[] };
    const io = {
      read: () => state.queue,
      write: (q: QueuedChange[]) => {
        state.queue = q;
      },
      send: (c: QueuedChange) => {
        state.sent.push(c);
        return answer(c);
      },
      onSaved: vi.fn<() => void>(),
      onRetry: vi.fn<(message: string) => void>(),
      onDrop: vi.fn<(message: string) => void>(),
    };
    return { state, io };
  };

  it("stops at a retryable error and keeps the queue", async () => {
    const q = [check("a"), check("b")];
    const { state, io } = setup(q, async () => ({
      error: "Mealie didn't answer",
      retry: true,
    }));
    await flushQueue(io);
    expect(state.queue).toEqual(q);
    expect(state.sent).toHaveLength(1);
    expect(io.onRetry).toHaveBeenCalledWith("Mealie didn't answer");
  });

  it("stops when the request itself fails (offline)", async () => {
    const q = [check("a")];
    const { state, io } = setup(q, () =>
      Promise.reject(new TypeError("offline"))
    );
    await flushQueue(io);
    expect(state.queue).toEqual(q);
  });

  it("drops a change that can never succeed, with its dependants, and carries on", async () => {
    const failed = add("local-1");
    const tick = check("local-1");
    const other = check("b");
    const { state, io } = setup([failed, tick, other], async (c) =>
      c === failed ? { error: "Mealie refused that change." } : {}
    );
    await flushQueue(io);
    expect(state.queue).toEqual([]);
    expect(state.sent).toEqual([failed, other]);
    expect(io.onDrop).toHaveBeenCalledWith("Mealie refused that change.");
  });

  it("points later changes at the id Mealie gave a queued add", async () => {
    const a = add("local-1", "coffee");
    const tick = check("local-1");
    const { state, io } = setup([a, tick], async (c) =>
      c.kind === "add" ? { item: { id: "real" } } : {}
    );
    await flushQueue(io);
    expect(state.sent[1]).toEqual({ ...tick, itemId: "real" });
    expect(state.queue).toEqual([]);
  });

  it("keeps a change queued while another is being sent", async () => {
    const first = check("a");
    const later = check("b");
    let release = () => {};
    const { state, io } = setup([first], (c) =>
      c === first
        ? new Promise<SendResult>((resolve) => {
            release = () => resolve({});
          })
        : Promise.resolve({})
    );
    const run = flushQueue(io);
    state.queue = [...state.queue, later]; // the user ticks something meanwhile
    release();
    await run;
    expect(state.sent).toEqual([first, later]);
    expect(state.queue).toEqual([]);
  });
});

describe("applyQueue", () => {
  it("shows queued ticks, adds and removals as pending", () => {
    const items = [item("a"), item("b")];
    const out = applyQueue(items, [
      check("a"),
      remove("b"),
      add("local-1", "coffee"),
    ]);
    expect(out).toMatchObject([
      { id: "a", checked: true, pending: true },
      { id: "local-1", text: "coffee", checked: false, pending: true },
    ]);
    expect(items[0].checked).toBe(false); // the input is untouched
  });

  it("ignores changes to items that are gone", () => {
    expect(applyQueue([item("a")], [check("x")])).toEqual([item("a")]);
  });
});

describe("replaceTempId", () => {
  it("points later changes at the saved item", () => {
    const tick = check("local-1");
    expect(replaceTempId([tick], "local-1", "real")).toEqual([
      { ...tick, itemId: "real" },
    ]);
  });
});

describe("groupItems", () => {
  it("groups unticked items by label, A–Z with unlabelled last, and lists ticked ones apart", () => {
    const { groups, done } = groupItems([
      item("milk", { label: "Dairy", position: 2 }),
      item("salt"),
      item("apples", { label: "Produce", position: 1 }),
      item("butter", { label: "Dairy", position: 1 }),
      item("bread", { checked: true, position: 3 }),
    ]);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["Dairy", ["butter", "milk"]],
      ["Produce", ["apples"]],
      ["Other", ["salt"]],
    ]);
    expect(done.map((i) => i.id)).toEqual(["bread"]);
  });
});
