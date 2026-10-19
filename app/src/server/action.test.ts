import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const auth = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock("@/auth", () => ({ auth }));

import { SIGNED_OUT, userAction, userFormAction } from "./action";
import { UserFacingError } from "./errors";

const alex = {
  id: "7b0c1c9e-4c1a-4f55-9a0e-2f4d8d6f2a10",
  name: "Alex",
  email: "alex@example.test",
};

describe("userAction", () => {
  const handler = vi.fn<
    (
      input: { n: number },
      user: { id: string }
    ) => Promise<{ n: number; by: string }>
  >(async (input, user) => ({ n: input.n, by: user.id }));
  const action = userAction(z.object({ n: z.number().int() }), handler);

  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: alex });
  });

  it("rejects callers without a session before reading the input", async () => {
    auth.mockResolvedValue(null);
    expect(await action({ n: 1 })).toEqual({ error: SIGNED_OUT });
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects input that doesn't match the schema", async () => {
    expect(await action({ n: 1.5 })).toEqual({ error: "Invalid input" });
    expect(await action("nonsense" as never)).toEqual({
      error: "Invalid input",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes the parsed input and the signed-in user to the handler", async () => {
    expect(await action({ n: 2 })).toEqual({ n: 2, by: alex.id });
  });

  it("shows UserFacingError messages and hides everything else", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    handler.mockRejectedValueOnce(
      new UserFacingError("That meal no longer exists")
    );
    expect(await action({ n: 3 })).toEqual({
      error: "That meal no longer exists",
    });
    handler.mockRejectedValueOnce(
      new Error("connection string postgres://secret")
    );
    expect(await action({ n: 3 })).toEqual({
      error: "Something went wrong. Try again.",
    });
    quiet.mockRestore();
  });

  it("uses a custom message for invalid input when given one", async () => {
    const custom = userAction(z.object({ n: z.number() }), handler, {
      invalid: () => "Pick a number",
    });
    expect(await custom({ n: "x" } as never)).toEqual({
      error: "Pick a number",
    });
  });
});

describe("userFormAction", () => {
  const schema = z.preprocess(
    (f) => (f instanceof FormData ? { name: f.get("name") } : f),
    z.object({ name: z.string() })
  );
  const action = userFormAction(schema, async ({ name }) => ({ ok: name }));

  it("ignores the previous state and reads the form", async () => {
    auth.mockResolvedValue({ user: alex });
    const form = new FormData();
    form.set("name", "Sam");
    expect(await action({ error: "old" }, form)).toEqual({ ok: "Sam" });
  });

  it("rejects callers without a session", async () => {
    auth.mockResolvedValue(null);
    expect(await action({}, new FormData())).toEqual({ error: SIGNED_OUT });
  });
});
