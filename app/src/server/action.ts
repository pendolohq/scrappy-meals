import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";

import "server-only";

import { RetryableError, UserFacingError } from "./errors";
import { currentUser, type SessionUser } from "./session";

export const SIGNED_OUT = "You are signed out. Reload the page.";

/**
 * `retry` marks errors worth trying again later (signed out, Mealie down), as
 * opposed to ones that never succeed (invalid input, item gone).
 */
export type ActionResult<R extends object = object> =
  | (R & { error?: undefined })
  | { error: string; retry?: true };

type Options = { invalid?: (err: z.ZodError) => string };

/**
 * Every server action is built with this. Server actions are public POST
 * endpoints that anyone can call with any arguments, so the session check and
 * input validation happen here, before the handler runs, not in each action.
 * Errors become `{ error }`: a UserFacingError keeps its message, anything
 * else is logged and replaced by a generic one. Being signed out and a
 * RetryableError add `retry: true`.
 */
export function userAction<S extends z.ZodType, R extends object>(
  schema: S,
  handler: (input: z.output<S>, user: SessionUser) => Promise<R>,
  opts: Options = {}
): (input: z.input<S>) => Promise<ActionResult<R>> {
  return async (input) => {
    const user = await currentUser();
    if (!user) {
      return { error: SIGNED_OUT, retry: true };
    }
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return { error: opts.invalid?.(parsed.error) ?? "Invalid input" };
    }
    try {
      return await handler(parsed.data, user);
    } catch (err) {
      unstable_rethrow(err); // redirect() and notFound() must reach Next.js
      if (err instanceof RetryableError) {
        return { error: err.message, retry: true };
      }
      if (err instanceof UserFacingError) {
        return { error: err.message };
      }
      console.error(err);
      return { error: "Something went wrong. Try again." };
    }
  };
}

/**
 * The same, for forms driven by useActionState: `(previousState, formData)`.
 * The schema receives the FormData, so it starts with a z.preprocess that
 * reads the fields.
 */
export function userFormAction<S extends z.ZodType, R extends object>(
  schema: S,
  handler: (input: z.output<S>, user: SessionUser) => Promise<R>,
  opts: Options = {}
): (prev: unknown, form: FormData) => Promise<ActionResult<R>> {
  const run = userAction(schema, handler, opts);
  return (_prev, form) => run(form as z.input<S>);
}
