import { eq } from "drizzle-orm";
// Runs against a real Postgres: DATABASE_TEST_URL=postgres://... bun run test:db
// The database is migrated and its users table emptied, so point it at a throwaway DB.
import { describe, expect, it } from "vitest";

import { testDbUrl, useTestDb } from "../../test/db";

import { users } from "./db/schema";
import {
  countUsers,
  createUser,
  findUserByEmail,
  listUsers,
  removeUser,
  setPassword,
  updateProfile,
  UserError,
  verifyCredentials,
} from "./users";

describe.skipIf(!testDbUrl)("users (Postgres)", () => {
  const db = useTestDb();
  const pw = "correct horse battery";

  it("creates a user with a normalised email and an argon2id hash", async () => {
    const u = await createUser(db, {
      name: " Alex ",
      email: " Alex@Example.TEST ",
      password: pw,
    });
    expect(u).toMatchObject({
      name: "Alex",
      email: "alex@example.test",
      sessionVersion: 0,
    });
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    expect(u.passwordHash).not.toContain(pw);
    expect(await countUsers(db)).toBe(1);
  });

  it.each([
    [{ name: "", email: "a@example.test", password: pw }, "Name is required"],
    [{ name: "A", email: "not-an-email", password: pw }, "Invalid email"],
    [{ name: "A", email: "a@example.test", password: "short" }, "at least 12"],
  ])("rejects invalid input %#", async (input, message) => {
    await expect(createUser(db, input)).rejects.toThrow(message);
  });

  it("rejects a duplicate email regardless of case", async () => {
    await createUser(db, { name: "A", email: "a@example.test", password: pw });
    await expect(
      createUser(db, { name: "B", email: "A@EXAMPLE.test", password: pw })
    ).rejects.toBeInstanceOf(UserError);
  });

  it("verifies credentials", async () => {
    await createUser(db, { name: "A", email: "a@example.test", password: pw });
    expect((await verifyCredentials(db, "A@example.test", pw))?.email).toBe(
      "a@example.test"
    );
    expect(
      await verifyCredentials(db, "a@example.test", "wrong password!!")
    ).toBeNull();
    expect(await verifyCredentials(db, "nobody@example.test", pw)).toBeNull();
  });

  it("changes the password and bumps the session version", async () => {
    await createUser(db, { name: "A", email: "a@example.test", password: pw });
    await setPassword(db, "a@example.test", "a different long one");
    expect(await verifyCredentials(db, "a@example.test", pw)).toBeNull();
    const u = await verifyCredentials(
      db,
      "a@example.test",
      "a different long one"
    );
    expect(u?.sessionVersion).toBe(1);
    await expect(
      setPassword(db, "nobody@example.test", "a different long one")
    ).rejects.toThrow("No user");
  });

  it("removes a user", async () => {
    await createUser(db, { name: "A", email: "a@example.test", password: pw });
    await removeUser(db, "A@example.test");
    expect(await listUsers(db)).toEqual([]);
    await expect(removeUser(db, "a@example.test")).rejects.toThrow("No user");
  });

  it("updates the profile, de-duplicating and sorting fasting days", async () => {
    const u = await createUser(db, {
      name: "A",
      email: "a@example.test",
      password: pw,
    });
    await updateProfile(db, u.id, {
      name: "Alex",
      targetKcal: 2100,
      targetProteinG: 150.5,
      targetCarbsG: null,
      targetFatG: 70,
      targetFibreG: 30,
      defaultFastingDays: [5, 1, 5],
    });
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row).toMatchObject({
      name: "Alex",
      targetKcal: 2100,
      targetProteinG: 150.5,
      targetCarbsG: null,
      defaultFastingDays: [1, 5],
    });
    await expect(
      updateProfile(db, u.id, {
        ...row,
        targetKcal: 2100.5,
        defaultFastingDays: [],
      } as never)
    ).rejects.toThrow("whole number");
    expect((await findUserByEmail(db, "a@example.test"))?.targetKcal).toBe(
      2100
    );
  });
});
