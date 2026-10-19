import { describe, expect, it } from "vitest";

import {
  applyQueue,
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

describe("enqueue", () => {
  it("keeps only the latest tick for an item", () => {
    let q: QueuedChange[] = [];
    q = enqueue(q, { kind: "check", itemId: "a", checked: true });
    q = enqueue(q, { kind: "check", itemId: "b", checked: true });
    q = enqueue(q, { kind: "check", itemId: "a", checked: false });
    expect(q).toEqual([
      { kind: "check", itemId: "b", checked: true },
      { kind: "check", itemId: "a", checked: false },
    ]);
  });

  it("drops earlier changes to an item that is removed", () => {
    let q: QueuedChange[] = [];
    q = enqueue(q, { kind: "check", itemId: "a", checked: true });
    q = enqueue(q, { kind: "remove", itemId: "a" });
    expect(q).toEqual([{ kind: "remove", itemId: "a" }]);
  });

  it("forgets an item added offline and removed before it was saved", () => {
    let q: QueuedChange[] = [];
    q = enqueue(q, { kind: "add", tempId: "local-1", text: "coffee" });
    q = enqueue(q, { kind: "check", itemId: "local-1", checked: true });
    q = enqueue(q, { kind: "remove", itemId: "local-1" });
    expect(q).toEqual([]);
  });
});

describe("applyQueue", () => {
  it("shows queued ticks, adds and removals as pending", () => {
    const items = [item("a"), item("b")];
    const out = applyQueue(items, [
      { kind: "check", itemId: "a", checked: true },
      { kind: "remove", itemId: "b" },
      { kind: "add", tempId: "local-1", text: "coffee" },
    ]);
    expect(out).toMatchObject([
      { id: "a", checked: true, pending: true },
      { id: "local-1", text: "coffee", checked: false, pending: true },
    ]);
    expect(items[0].checked).toBe(false); // the input is untouched
  });

  it("ignores changes to items that are gone", () => {
    expect(
      applyQueue([item("a")], [{ kind: "check", itemId: "x", checked: true }])
    ).toEqual([item("a")]);
  });
});

describe("replaceTempId", () => {
  it("points later changes at the saved item", () => {
    const q: QueuedChange[] = [
      { kind: "add", tempId: "local-1", text: "coffee" },
      { kind: "check", itemId: "local-1", checked: true },
    ];
    expect(replaceTempId(q.slice(1), "local-1", "real")).toEqual([
      { kind: "check", itemId: "real", checked: true },
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
