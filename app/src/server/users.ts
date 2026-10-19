import { hash, verify } from "@node-rs/argon2";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import "server-only";

import type { Db } from "./db/client";
import { type User, users } from "./db/schema";
import { UserFacingError } from "./errors";

export const MIN_PASSWORD_LENGTH = 12;

export class UserError extends UserFacingError {
  name = "UserError";
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

export function validatePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new UserError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    );
  }
  if (password.length > 1024) {
    throw new UserError("Password is too long");
  }
}

// argon2id with the library defaults (m=19 MiB, t=2, p=1), matching OWASP's minimum.
const hashPassword = (password: string) => hash(password);

// Verified against when the email is unknown, so both failures take the same time.
let dummyHash: Promise<string> | undefined;

export async function createUser(
  db: Db,
  input: { name: string; email: string; password: string }
): Promise<User> {
  const name = input.name.trim();
  if (!name) {
    throw new UserError("Name is required");
  }
  const parsed = emailSchema.safeParse(input.email);
  if (!parsed.success) {
    throw new UserError("Invalid email address");
  }
  validatePassword(input.password);

  const existing = await findUserByEmail(db, parsed.data);
  if (existing) {
    throw new UserError(`A user with email ${parsed.data} already exists`);
  }

  const [user] = await db
    .insert(users)
    .values({
      name,
      email: parsed.data,
      passwordHash: await hashPassword(input.password),
    })
    .returning();
  return user;
}

export async function setPassword(
  db: Db,
  email: string,
  password: string
): Promise<void> {
  validatePassword(password);
  const updated = await db
    .update(users)
    // Bumping the version signs out every existing session for this user.
    .set({
      passwordHash: await hashPassword(password),
      sessionVersion: sql`${users.sessionVersion} + 1`,
    })
    .where(eq(users.email, normaliseEmail(email)))
    .returning({ id: users.id });
  if (updated.length === 0) {
    throw new UserError(`No user with email ${normaliseEmail(email)}`);
  }
}

export async function removeUser(db: Db, email: string): Promise<void> {
  const deleted = await db
    .delete(users)
    .where(eq(users.email, normaliseEmail(email)))
    .returning({ id: users.id });
  if (deleted.length === 0) {
    throw new UserError(`No user with email ${normaliseEmail(email)}`);
  }
}

export async function listUsers(db: Db) {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.createdAt));
}

export async function countUsers(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return row.n;
}

export async function findUserByEmail(
  db: Db,
  email: string
): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normaliseEmail(email)));
  return user;
}

export async function findUserById(
  db: Db,
  id: string
): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

/** Returns the user if the password matches. Takes the same time whether or not the email exists. */
export async function verifyCredentials(
  db: Db,
  email: string,
  password: string
): Promise<User | null> {
  const user = await findUserByEmail(db, email);
  if (!user) {
    dummyHash ??= hashPassword("dummy-password-for-timing");
    await verify(await dummyHash, password).catch(() => false);
    return null;
  }
  const ok = await verify(user.passwordHash, password).catch(() => false);
  return ok ? user : null;
}

const target = (max: number) =>
  z
    .number({ error: "must be a number" })
    .positive("must be more than 0")
    .max(max, `must be at most ${max}`)
    .nullable();

export const profileSchema = z.object({
  name: z.string().trim().min(1, "is required").max(80, "is too long"),
  targetKcal: target(20_000).refine(
    (v) => v === null || Number.isInteger(v),
    "must be a whole number"
  ),
  targetProteinG: target(1_000),
  targetCarbsG: target(2_000),
  targetFatG: target(1_000),
  targetFibreG: target(500),
  defaultFastingDays: z.array(z.number().int().min(1).max(7)).max(7),
});
export type ProfileInput = z.infer<typeof profileSchema>;

export async function updateProfile(
  db: Db,
  userId: string,
  input: ProfileInput
): Promise<void> {
  const data = profileSchema.parse(input);
  await db
    .update(users)
    .set({
      ...data,
      defaultFastingDays: [...new Set(data.defaultFastingDays)].sort(),
    })
    .where(eq(users.id, userId));
}
