import { and, eq, sql } from "drizzle-orm";

import "server-only";

import type { Db } from "./db/client";
import { offContributions } from "./db/schema";
import {
  type ContributionProduct,
  type OffFields,
  offCandidateFields,
  remainingFields,
} from "./domain/off-contribution";
import type { OffProduct } from "./domain/product";
import { UserFacingError } from "./errors";
import {
  lookupOpenFoodFacts,
  type OffAccount,
  offAccount,
  offAppUuid,
  type OffResult,
  OffWriteError,
  writeOpenFoodFacts,
} from "./openfoodfacts";

export type ContributionStatus = "pending" | "sent" | "nothing" | "failed";

/** What a call did: "disabled" and "skipped" leave the stored row alone. */
export type ContributionOutcome =
  | "disabled"
  | "skipped"
  | "sent"
  | "nothing"
  | "failed";

type Deps = {
  account: OffAccount | null;
  lookup: (barcode: string) => Promise<OffResult>;
  write: (
    fields: OffFields,
    account: OffAccount,
    appUuid: string
  ) => Promise<void>;
  appUuid: (userId: string) => string;
};

const defaults = (): Deps => ({
  account: offAccount(),
  // Strict: an unreadable reply must fail the attempt, not read as an empty record.
  lookup: (barcode) => lookupOpenFoodFacts(barcode, { strict: true }),
  write: (fields, account, uuid) => writeOpenFoodFacts(fields, account, uuid),
  appUuid: (userId) => {
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
      throw new Error("AUTH_SECRET must be set");
    }
    return offAppUuid(userId, secret);
  },
});

/** Whether products can be sent to Open Food Facts at all. */
export const contributionEnabled = () => offAccount() !== null;

// A pending claim this old belongs to a process that died mid-write.
const STALE_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_ERROR = 200;

/** A row we may start again: failed, or abandoned mid-write; and not tried to death. */
const claimable = sql`(${offContributions.status} = 'failed' or (${offContributions.status} = 'pending' and ${offContributions.updatedAt} < now() - make_interval(secs => ${STALE_MS / 1000}))) and ${offContributions.attempts} < ${MAX_ATTEMPTS}`;

const reason = (err: unknown): string => {
  // Only our own error classes carry text written for people; the rest is
  // logged for us, not stored.
  if (err instanceof UserFacingError || err instanceof OffWriteError) {
    return err.message.slice(0, MAX_ERROR);
  }
  console.error("Open Food Facts contribution failed", err);
  return "Something went wrong sending it";
};

/**
 * Looks at what Open Food Facts has now, works out what to send with
 * `compute`, sends it and records how it went. The row must be claimed
 * ("pending") by the caller.
 */
async function send(
  db: Db,
  d: Deps,
  account: OffAccount,
  barcode: string,
  userId: string,
  compute: (current: OffProduct | null) => OffFields | null
): Promise<"sent" | "nothing" | "failed"> {
  const finish = async (
    status: "sent" | "nothing" | "failed",
    set: { fields?: OffFields | null; error?: string | null } = {}
  ) => {
    await db
      .update(offContributions)
      .set({ status, error: null, ...set })
      .where(eq(offContributions.barcode, barcode));
    return status;
  };
  try {
    const off = await d.lookup(barcode);
    const fields = compute(off.status === "found" ? off.product : null);
    if (!fields) {
      return await finish("nothing", { fields: null });
    }
    // Kept before the write, so a failure can be retried from it.
    await db
      .update(offContributions)
      .set({ fields })
      .where(eq(offContributions.barcode, barcode));
    await d.write(fields, account, d.appUuid(userId));
    return await finish("sent");
  } catch (err) {
    return finish("failed", { error: reason(err) });
  }
}

/**
 * Sends a newly saved product to Open Food Facts, once per barcode: what it
 * lacks, or all of it when it doesn't know the product. Never throws for an
 * Open Food Facts problem; the outcome is in the `off_contributions` row.
 */
export async function contributeProduct(
  db: Db,
  product: ContributionProduct,
  userId: string,
  deps: Partial<Deps> = {}
): Promise<ContributionOutcome> {
  const d = { ...defaults(), ...deps };
  if (!d.account) {
    return "disabled";
  }
  // One statement claims the barcode: a new row, or a failed (or abandoned)
  // one. A sent, empty or running one is left alone.
  // The fields are kept from the claim on, so an attempt that dies before
  // working out the gaps (Open Food Facts down) can still be retried.
  const candidate = offCandidateFields(product);
  const [claimed] = await db
    .insert(offContributions)
    .values({
      barcode: product.barcode,
      status: "pending",
      fields: candidate,
      attempts: 1,
      createdBy: userId,
    })
    .onConflictDoUpdate({
      target: offContributions.barcode,
      set: {
        status: "pending",
        fields: candidate,
        error: null,
        attempts: sql`${offContributions.attempts} + 1`,
        updatedAt: new Date(),
      },
      setWhere: claimable,
    })
    .returning({ barcode: offContributions.barcode });
  if (!claimed) {
    return "skipped";
  }
  return send(db, d, d.account, product.barcode, userId, (current) =>
    remainingFields(candidate, current)
  );
}

/** Tries a failed contribution again, with what Open Food Facts lacks by now. */
export async function retryContribution(
  db: Db,
  barcode: string,
  userId: string,
  deps: Partial<Deps> = {}
): Promise<ContributionOutcome> {
  const d = { ...defaults(), ...deps };
  if (!d.account) {
    return "disabled";
  }
  const [claimed] = await db
    .update(offContributions)
    .set({
      status: "pending",
      error: null,
      attempts: sql`${offContributions.attempts} + 1`,
    })
    .where(and(eq(offContributions.barcode, barcode), claimable))
    .returning({ fields: offContributions.fields });
  if (!claimed) {
    return "skipped";
  }
  const stored = claimed.fields;
  return send(db, d, d.account, barcode, userId, (current) =>
    stored ? remainingFields(stored, current) : null
  );
}

export type ContributionState = {
  /** An abandoned attempt reads as "failed". */
  status: ContributionStatus;
  retryable: boolean;
};

/** How the barcode's contribution stands, or null when it was never attempted. */
export async function getContribution(
  db: Db,
  barcode: string
): Promise<ContributionState | null> {
  const [row] = await db
    .select({
      status: offContributions.status,
      attempts: offContributions.attempts,
      updatedAt: offContributions.updatedAt,
    })
    .from(offContributions)
    .where(eq(offContributions.barcode, barcode));
  if (!row) {
    return null;
  }
  const abandoned =
    row.status === "pending" && Date.now() - row.updatedAt.getTime() > STALE_MS;
  const status = abandoned ? "failed" : row.status;
  return {
    status,
    retryable: status === "failed" && row.attempts < MAX_ATTEMPTS,
  };
}
