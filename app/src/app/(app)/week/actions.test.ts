import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock("@/auth", () => ({ auth }));

const after = vi.hoisted(() => vi.fn<(work: () => Promise<void>) => void>());
vi.mock("next/server", () => ({ after }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn<(path: string) => void>(),
}));
vi.mock("@/server/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/server/today", () => ({ viewerToday: async () => "2026-10-21" }));

const addCheckedMeal = vi.hoisted(() =>
  vi.fn<() => Promise<void>>(async () => {})
);
vi.mock("@/server/plan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/plan")>()),
  addCheckedMeal,
  checkNewMeal: async () => {},
}));
const saveProduct = vi.hoisted(() =>
  vi.fn<(input: unknown) => Promise<{ slug: string }>>(async () => ({
    slug: "chocolate-bar",
  }))
);
vi.mock("@/server/products", () => ({
  saveProduct,
  lookupProduct: vi.fn<() => void>(),
  loadKnownProduct: vi.fn<() => void>(),
}));
const contributeProduct = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<string>>(async () => "sent")
);
vi.mock("@/server/off-contribute", () => ({ contributeProduct }));

import { saveProductAction } from "./actions";

const alex = { id: "user-alex", name: "Alex", email: "alex@example.test" };

const input = {
  barcode: "5000159461122",
  name: "Chocolate bar",
  servingGrams: 60,
  servingUnit: "g" as const,
  packGrams: 180,
  per100: { kcal: 364, protein: 33.8 },
  fromOpenFoodFacts: false,
  edited: false,
  date: "2026-10-21",
  slot: "snack" as const,
  snackIndex: 0,
  baseServings: 1,
  alreadyHad: true,
};

describe("saveProductAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: alex });
  });

  it("doesn't contribute unless asked: contribute defaults to false", async () => {
    await expect(saveProductAction(input)).resolves.toEqual({
      slug: "chocolate-bar",
    });
    expect(after).not.toHaveBeenCalled();
    expect(contributeProduct).not.toHaveBeenCalled();
    // The flag is not part of what is saved in Mealie.
    expect(saveProduct.mock.calls[0][0]).not.toHaveProperty("contribute");
    expect(saveProduct.mock.calls[0][0]).not.toHaveProperty("servingKnown");
  });

  it("contributes after the save, as the signed-in user, with product data only", async () => {
    await expect(
      saveProductAction({
        ...input,
        contribute: true,
        servingKnown: true,
        packKnown: true,
      })
    ).resolves.toEqual({ slug: "chocolate-bar" });
    expect(after).toHaveBeenCalledTimes(1);
    expect(contributeProduct).not.toHaveBeenCalled(); // not before the response

    await after.mock.calls[0][0]();
    expect(contributeProduct).toHaveBeenCalledWith(
      {},
      {
        barcode: "5000159461122",
        name: "Chocolate bar",
        servingGrams: 60,
        servingUnit: "g",
        packGrams: 180,
        per100: { kcal: 364, protein: 33.8 },
      },
      "user-alex"
    );
  });

  it("holds back a serving and pack size nobody confirmed", async () => {
    await saveProductAction({ ...input, contribute: true });
    await after.mock.calls[0][0]();
    expect(contributeProduct.mock.calls[0][1]).toMatchObject({
      servingGrams: null,
      packGrams: null,
    });
    // They are still saved in Mealie, where the person chose them.
    expect(saveProduct.mock.calls[0][0]).toMatchObject({
      servingGrams: 60,
      packGrams: 180,
    });
  });

  it("a failing contribution doesn't surface", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    contributeProduct.mockRejectedValueOnce(new Error("db down"));
    await saveProductAction({ ...input, contribute: true });
    await expect(after.mock.calls[0][0]()).resolves.toBeUndefined();
  });

  it("does nothing for a signed-out caller", async () => {
    auth.mockResolvedValue(null);
    const result = await saveProductAction({ ...input, contribute: true });
    expect(result).toHaveProperty("error");
    expect(saveProduct).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });
});
