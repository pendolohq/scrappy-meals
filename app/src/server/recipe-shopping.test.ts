import { describe, expect, it, vi } from "vitest";

import { RetryableError, UserFacingError } from "./errors";
import { MealieUnavailableError } from "./mealie/client";
import { setNoShopping } from "./recipe-shopping";

function deps(
  extras: Record<string, unknown> | null = { scrappyReview: "done" }
) {
  return {
    getRecipe: vi.fn<
      (slug: string) => Promise<{ extras: Record<string, unknown> } | null>
    >(async () => (extras === null ? null : { extras })),
    patch: vi.fn<
      (slug: string, extras: Record<string, string>) => Promise<void>
    >(async () => undefined),
    refresh: vi.fn<(slug: string) => Promise<void>>(async () => undefined),
  };
}

describe("setNoShopping", () => {
  it("writes the flag into the extras, keeping the rest, then refreshes the cache", async () => {
    const d = deps();
    await setNoShopping("cappuccino", true, d);
    expect(d.patch).toHaveBeenCalledWith("cappuccino", {
      scrappyReview: "done",
      scrappyNoShopping: "true",
    });
    expect(d.refresh).toHaveBeenCalledWith("cappuccino");
  });

  it("takes it out to put the recipe back on the list", async () => {
    const d = deps({ scrappyNoShopping: "true" });
    await setNoShopping("kiwi", false, d);
    expect(d.patch).toHaveBeenCalledWith("kiwi", {});
  });

  it("says when the recipe is gone, and asks for a retry while Mealie is down", async () => {
    await expect(
      setNoShopping("gone", true, deps(null))
    ).rejects.toBeInstanceOf(UserFacingError);
    const down = {
      ...deps(),
      getRecipe: async () => {
        throw new MealieUnavailableError("down");
      },
    };
    await expect(setNoShopping("kiwi", true, down)).rejects.toBeInstanceOf(
      RetryableError
    );
  });
});
