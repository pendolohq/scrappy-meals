import { describe, expect, it, vi } from "vitest";

import {
  applyQueue,
  dropFailed,
  flushQueue,
  groupItems,
  type QueuedChange,
  type SendResult,
  type ShopItemView,
} from "./shop-list";

const item = (id: string, over: Partial<ShopItemView> = {}): ShopItemView => ({
  id,
  source: "plan",
  text: id,
  amount: null,
  detail: null,
  aisle: "Other",
  checked: false,
  amounts: [],
  position: 0,
  ...over,
});

let n = 0;
const check = (
  itemId: string,
  checked = true,
  source: "plan" | "extra" = "plan",
  amounts: { quantity: number; unit: string | null }[] = []
): QueuedChange => ({
  id: `c${++n}`,
  kind: "check",
  source,
  itemId,
  checked,
  amounts,
});
const add = (itemId: string, text = itemId): QueuedChange => ({
  id: `c${++n}`,
  kind: "add",
  itemId,
  text,
});
const remove = (
  itemId: string,
  source: "plan" | "extra" = "plan"
): QueuedChange => ({
  id: `c${++n}`,
  kind: "remove",
  source,
  itemId,
});

describe("dropFailed", () => {
  it("drops only the failed change", () => {
    const a = check("a");
    const b = check("b");
    expect(dropFailed([a, b], a)).toEqual([b]);
  });

  it("drops later changes to an extra whose add failed", () => {
    const failed = add("x1");
    const tick = check("x1", true, "extra");
    const removal = remove("x1", "extra");
    const other = check("b");
    expect(dropFailed([failed, tick, removal, other], failed)).toEqual([other]);
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
      error: "The database didn't answer",
      retry: true,
    }));
    await flushQueue(io);
    expect(state.queue).toEqual(q);
    expect(state.sent).toHaveLength(1);
    expect(io.onRetry).toHaveBeenCalledWith("The database didn't answer");
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
    const failed = add("x1");
    const tick = check("x1", true, "extra");
    const other = check("b");
    const { state, io } = setup([failed, tick, other], async (c) =>
      c === failed ? { error: "That can't be added." } : {}
    );
    await flushQueue(io);
    expect(state.queue).toEqual([]);
    expect(state.sent).toEqual([failed, other]);
    expect(io.onDrop).toHaveBeenCalledWith("That can't be added.");
  });

  it("sends later changes to a queued add unchanged, as the add already carries the id", async () => {
    const a = add("x1", "coffee");
    const tick = check("x1", true, "extra");
    const { state, io } = setup([a, tick], async () => ({}));
    await flushQueue(io);
    expect(state.sent).toEqual([a, tick]);
    expect(state.queue).toEqual([]);
    expect(io.onSaved).toHaveBeenCalledTimes(2);
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
      add("x1", "coffee"),
    ]);
    expect(out).toMatchObject([
      { id: "a", checked: true, pending: true },
      {
        id: "x1",
        source: "extra",
        text: "coffee",
        aisle: "Other",
        checked: false,
        pending: true,
      },
    ]);
    expect(items[0].checked).toBe(false); // the input is untouched
  });

  it("puts an added extra after everything else", () => {
    const out = applyQueue([item("a", { position: 5 })], [add("x1")]);
    expect(out[1].position).toBeGreaterThan(out[0].position);
  });

  it("just marks a partly-bought line checked", () => {
    const partly = item("lentils", {
      amount: "300 g more",
      detail: "500 g in all",
    });
    const [out] = applyQueue(
      [partly],
      [check("lentils", true, "plan", [{ quantity: 500, unit: "g" }])]
    );
    expect(out).toMatchObject({ checked: true, pending: true });
  });

  it("applies later changes to a queued add", () => {
    const out = applyQueue(
      [],
      [add("x1", "coffee"), check("x1", true, "extra")]
    );
    expect(out).toMatchObject([{ id: "x1", checked: true }]);
    expect(applyQueue([], [add("x1"), remove("x1", "extra")])).toEqual([]);
  });

  it("ignores changes to items that are gone", () => {
    expect(applyQueue([item("a")], [check("x")])).toEqual([item("a")]);
  });
});

describe("groupItems", () => {
  it("groups unticked items by their aisle, in the shop's order, and lists ticked ones apart", () => {
    const { groups, done } = groupItems([
      item("milk", { aisle: "Dairy, eggs & tofu", position: 2 }),
      item("salt"),
      item("tea", { source: "extra" }),
      item("apples", { aisle: "Fruit & veg", position: 1 }),
      item("butter", { aisle: "Dairy, eggs & tofu", position: 1 }),
      item("tofu", { aisle: "Dairy, eggs & tofu", position: 3 }),
      item("bread", { checked: true, position: 3 }),
    ]);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["Fruit & veg", ["apples"]],
      ["Dairy, eggs & tofu", ["butter", "milk", "tofu"]],
      ["Other", ["salt", "tea"]],
    ]);
    expect(done.map((i) => i.id)).toEqual(["bread"]);
  });
});
