import { APIConnectionError } from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import { RetryableError, UserFacingError } from "./errors";
import {
  type Estimator,
  estimateForReview,
  estimatingEnabled,
  nutritionEstimator,
} from "./nutrition-estimate";

const input = {
  name: "Lentil soup",
  servings: 4,
  ingredients: ["200 g lentils", "1 onion"],
};
const estimate = {
  servings: 4,
  perServing: { kcal: 420, protein: 18, carbs: 50, fat: 15.5, fibre: 6 },
};
const open = { hit: () => true };

describe("estimating is on only with an API key", () => {
  it.each([
    [{}, false],
    [{ ANTHROPIC_API_KEY: "  " }, false],
    [{ ANTHROPIC_API_KEY: "sk-ant-x" }, true],
  ])("%j", (env, on) => {
    expect(estimatingEnabled(env)).toBe(on);
    expect(nutritionEstimator(env) !== null).toBe(on);
  });
});

describe("estimateForReview", () => {
  it("returns the estimate", async () => {
    const run = vi.fn<Estimator>().mockResolvedValue(estimate);

    await expect(
      estimateForReview(input, "u1", { estimate: run, limiter: open })
    ).resolves.toEqual(estimate);
    expect(run).toHaveBeenCalledWith(input);
  });

  it("says when estimating isn't set up", async () => {
    await expect(
      estimateForReview(input, "u1", { estimate: null, limiter: open })
    ).rejects.toThrow(
      new UserFacingError("Estimating nutrition isn't set up.")
    );
  });

  it("limits estimates per person", async () => {
    const hit = vi.fn<(key: string) => boolean>().mockReturnValue(false);
    const run = vi.fn<Estimator>();

    await expect(
      estimateForReview(input, "u1", { estimate: run, limiter: { hit } })
    ).rejects.toBeInstanceOf(UserFacingError);
    expect(hit).toHaveBeenCalledWith("u1");
    expect(run).not.toHaveBeenCalled();
  });

  it("asks to fill it in by hand when there is no usable estimate", async () => {
    await expect(
      estimateForReview(input, "u1", {
        estimate: async () => null,
        limiter: open,
      })
    ).rejects.toThrow(/Fill it in by hand/);
  });

  it("offers a retry when the API can't be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new APIConnectionError({ message: "down" });

    await expect(
      estimateForReview(input, "u1", {
        estimate: () => Promise.reject(err),
        limiter: open,
      })
    ).rejects.toBeInstanceOf(RetryableError);
  });

  it("lets other failures through to the generic message", async () => {
    const err = new Error("bad request");

    await expect(
      estimateForReview(input, "u1", {
        estimate: () => Promise.reject(err),
        limiter: open,
      })
    ).rejects.toBe(err);
  });
});
