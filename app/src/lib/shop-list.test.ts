import { describe, expect, it } from "vitest";

import {
  applyQueue,
  dropFailed,
  enqueue,
  groupItems,
  type QueuedChange,
  replaceTempId,
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

describe("enqueue", () => {
  it("keeps only the latest tick for an item", () => {
    const b = check("b");
    const a2 = check("a", false);
    let q = enqueue([], check("a"));
    q = enqueue(q, b);
    q = enqueue(q, a2);
    expect(q).toEqual([b, a2]);
  });

  it("drops earlier changes to an item that is removed", () => {
    const r = remove("a");
    expect(enqueue(enqueue([], check("a")), r)).toEqual([r]);
  });

  it("forgets an item added offline and removed before it was sent", () => {
    let q = enqueue([], add("local-1", "coffee"));
    q = enqueue(q, check("local-1"));
    q = enqueue(q, remove("local-1"));
    expect(q).toEqual([]);
  });

  it("leaves the change being sent alone", () => {
    const sending = check("a");
    const again = check("a", false);
    expect(enqueue([sending], again, sending.id)).toEqual([sending, again]);
  });

  it("keeps a removal of an item whose add is already being sent", () => {
    const sending = add("local-1");
    const r = remove("local-1");
    const q = enqueue([sending], r, sending.id);
    expect(q).toEqual([sending, r]);
    // Once Mealie answers, the removal targets the real item.
    expect(replaceTempId(q.slice(1), "local-1", "real")).toEqual([
      { ...r, itemId: "real" },
    ]);
  });
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
