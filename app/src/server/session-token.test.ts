import { describe, expect, it, vi } from "vitest";

import { refreshToken } from "./session-token";

const token = { uid: "u1", sv: 2, name: "Old", email: "old@example.test" };
const user = { name: "Alex", email: "alex@example.test", sessionVersion: 2 };

describe("refreshToken", () => {
  it("refreshes the name and email of a current session", async () => {
    expect(await refreshToken(token, async () => user)).toMatchObject({
      uid: "u1",
      name: "Alex",
      email: "alex@example.test",
    });
  });

  it("ends the session of a removed user or after a password change", async () => {
    expect(await refreshToken(token, async () => undefined)).toBeNull();
    expect(
      await refreshToken(token, async () => ({ ...user, sessionVersion: 3 }))
    ).toBeNull();
    expect(await refreshToken({}, async () => user)).toBeNull();
  });

  it("keeps the session while Postgres can't be reached", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // Drizzle's DrizzleQueryError wraps the driver's error.
    const refused = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const down = async () => {
      throw new Error("Failed query", { cause: refused });
    };
    expect(await refreshToken(token, down)).toBe(token);
    log.mockRestore();
  });

  it("fails on any other error rather than skipping the check", async () => {
    const broken = async () => {
      throw Object.assign(
        new Error('column "session_version" does not exist'),
        {
          code: "42703",
        }
      );
    };
    await expect(refreshToken(token, broken)).rejects.toThrow(
      /session_version/
    );
  });
});
