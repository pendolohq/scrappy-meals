import Anthropic, {
  APIConnectionError,
  InternalServerError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import "server-only";

import {
  checkEstimate,
  ESTIMATE_SYSTEM,
  type Estimate,
  type EstimateInput,
  estimatePrompt,
  estimateSchema,
} from "./domain/nutrition-estimate";
import { RetryableError, UserFacingError } from "./errors";
import { createRateLimiter } from "./rate-limit";

const MODEL = "claude-opus-5-5";
const TIMEOUT_MS = 60_000;

export type Estimator = (input: EstimateInput) => Promise<Estimate | null>;

/** Estimating is on when the server has an Anthropic API key. */
export const estimatingEnabled = (
  env: Record<string, string | undefined> = process.env
) => Boolean(env.ANTHROPIC_API_KEY?.trim());

/**
 * Estimates per-serving nutrition from a recipe's ingredients with Claude.
 * Null when `ANTHROPIC_API_KEY` isn't set: estimating is off.
 */
export function nutritionEstimator(
  env: Record<string, string | undefined> = process.env
): Estimator | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  // Passed explicitly so the SDK never falls back to other credentials on the server.
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
  return (input) => estimateWith(client, input);
}

async function estimateWith(
  client: Anthropic,
  input: EstimateInput
): Promise<Estimate | null> {
  const ingredients = input.ingredients
    .map((line) => line.trim())
    .filter(Boolean);
  if (ingredients.length === 0) {
    return null;
  }
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: {
      effort: "medium",
      format: zodOutputFormat(estimateSchema),
    },
    system: ESTIMATE_SYSTEM,
    messages: [
      {
        role: "user",
        content: estimatePrompt({ ...input, ingredients }),
      },
    ],
  });
  if (response.stop_reason !== "end_turn" || !response.parsed_output) {
    console.warn(
      `nutrition estimate: no usable answer (${response.stop_reason})`
    );
    return null;
  }
  const estimate = checkEstimate(response.parsed_output, input.servings);
  if (!estimate) {
    console.warn("nutrition estimate: implausible answer", {
      recipe: input.name,
      reply: response.parsed_output,
    });
  }
  return estimate;
}

// Each estimate spends API credits, so a signed-in user can't hammer it.
const limiter = createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 });

type ReviewDeps = {
  estimate: Estimator | null;
  limiter: { hit: (key: string) => boolean };
};

/**
 * An estimate for the review page, from the ingredients as the form has them
 * now. Nothing is saved: the person checks the numbers and saves the review.
 */
export async function estimateForReview(
  input: EstimateInput,
  userId: string,
  deps: Partial<ReviewDeps> = {}
): Promise<Estimate> {
  const d = { estimate: nutritionEstimator(), limiter, ...deps };
  if (!d.estimate) {
    throw new UserFacingError("Estimating nutrition isn't set up.");
  }
  if (!d.limiter.hit(userId)) {
    throw new UserFacingError("Too many estimates. Try again in a while.");
  }
  let estimate: Estimate | null;
  try {
    estimate = await d.estimate(input);
  } catch (err) {
    if (
      err instanceof APIConnectionError ||
      err instanceof RateLimitError ||
      err instanceof InternalServerError
    ) {
      console.error("nutrition estimate failed", err);
      throw new RetryableError("Claude didn't answer. Try again in a minute.");
    }
    throw err;
  }
  if (!estimate) {
    throw new UserFacingError(
      "Couldn't estimate nutrition from these ingredients. Fill it in by hand."
    );
  }
  return estimate;
}
