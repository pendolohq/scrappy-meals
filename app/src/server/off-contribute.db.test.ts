import { eq } from "drizzle-orm";
// Runs against a real Postgres: DATABASE_TEST_URL=postgres://... bun run test:db
import { describe, expect, it, vi } from "vitest";

import { testDbUrl, useTestDb } from "../../test/db";
import {
  offFixtureCode,
  offFixtureText,
  type OffFixture,
} from "../../test/off-fixtures";

import { offContributions } from "./db/schema";
import type { ContributionProduct } from "./domain/off-contribution";
import { RetryableError } from "./errors";
import {
  contributeProduct,
  getContribution,
  retryContribution,
} from "./off-contribute";
import { lookupOpenFoodFacts, OffWriteError } from "./openfoodfacts";
import { createUser } from "./users";

const account = { userId: "scrappy-app", password: "hunter2-secret" };

const product: ContributionProduct = {
  barcode: "5060925291339",
  name: "Chocolate bar",
  servingGrams: 60,
  servingUnit: "g",
  packGrams: 180,
  per100: { kcal: 364, protein: 33.8, carbs: 28.2, fat: 14.8 },
};

const offFrom = (fixture: OffFixture) => () =>
  lookupOpenFoodFacts(offFixtureCode(fixture), {
    fetch: async () => new Response(offFixtureText(fixture)),
  });

type Write = (
  fields: Record<string, string>,
  account: { userId: string; password: string },
  uuid: string
) => Promise<void>;

function deps(
  over: {
    lookup?: () => ReturnType<typeof offFromNotFound>;
    configured?: boolean;
  } = {}
) {
  const write = vi.fn<Write>(async () => {});
  const lookup = vi.fn<() => ReturnType<typeof offFromNotFound>>(
    over.lookup ?? offFromNotFound
  );
  return {
    write,
    lookup,
    d: {
      account: over.configured === false ? null : account,
      lookup,
      write,
      appUuid: (userId: string) => `uuid-${userId}`,
    },
  };
}
const offFromNotFound = offFrom("not-found");

describe.skipIf(!testDbUrl)(
  "contributing to Open Food Facts (Postgres)",
  () => {
    const db = useTestDb();
    const alex = () =>
      createUser(db, {
        name: "Alex",
        email: "alex@example.test",
        password: "correct horse battery",
      });
    const rows = () => db.select().from(offContributions);

    it("does nothing, and keeps no row, when contributing isn't configured", async () => {
      const user = await alex();
      const { d, write, lookup } = deps({ configured: false });
      await expect(contributeProduct(db, product, user.id, d)).resolves.toBe(
        "disabled"
      );
      expect(await rows()).toEqual([]);
      expect(lookup).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    });

    it("sends a new product once, as sent, with the person's uuid and no credentials in the row", async () => {
      const user = await alex();
      const { d, write } = deps();
      await expect(contributeProduct(db, product, user.id, d)).resolves.toBe(
        "sent"
      );

      expect(write).toHaveBeenCalledTimes(1);
      const [fields, sentAccount, uuid] = write.mock.calls[0];
      expect(fields).toMatchObject({
        code: product.barcode,
        product_name: "Chocolate bar",
        quantity: "180 g",
      });
      expect(sentAccount).toEqual(account);
      expect(uuid).toBe(`uuid-${user.id}`);

      const [row] = await rows();
      expect(row).toMatchObject({
        barcode: product.barcode,
        status: "sent",
        error: null,
        attempts: 1,
        createdBy: user.id,
      });
      expect(row.fields).toEqual(fields);
      expect(JSON.stringify(row)).not.toContain("hunter2-secret");
    });

    it("skips a product that was already sent", async () => {
      const user = await alex();
      const first = deps();
      await contributeProduct(db, product, user.id, first.d);
      const second = deps();
      await expect(
        contributeProduct(db, product, user.id, second.d)
      ).resolves.toBe("skipped");
      expect(second.lookup).not.toHaveBeenCalled();
      expect(second.write).not.toHaveBeenCalled();
      expect(await rows()).toHaveLength(1);
    });

    it("records 'nothing' when Open Food Facts has it all, and doesn't ask again", async () => {
      const user = await alex();
      const full = {
        ...product,
        barcode: "5000159461122",
        per100: { kcal: 400, protein: 9, carbs: 50, fat: 20, fibre: 3 },
      };
      const { d, write } = deps({ lookup: offFrom("snickers") });
      await expect(contributeProduct(db, full, user.id, d)).resolves.toBe(
        "nothing"
      );
      expect(write).not.toHaveBeenCalled();
      expect((await rows())[0]).toMatchObject({
        status: "nothing",
        fields: null,
      });

      const again = deps();
      await expect(contributeProduct(db, full, user.id, again.d)).resolves.toBe(
        "skipped"
      );
      expect(again.lookup).not.toHaveBeenCalled();
    });

    it("sends only the gaps for a product Open Food Facts has in part", async () => {
      const user = await alex();
      const { d, write } = deps({ lookup: offFrom("grenade-multipack") });
      await contributeProduct(
        db,
        { ...product, barcode: offFixtureCode("grenade-multipack") },
        user.id,
        d
      );
      expect(write.mock.calls[0][0]).toEqual({
        code: offFixtureCode("grenade-multipack"),
        comment: "Added from Scrappy Meals",
        serving_size: "60 g",
      });
    });

    it("keeps a failure as 'failed', then a retry sends it", async () => {
      const user = await alex();
      const failing = deps();
      failing.write.mockRejectedValue(
        new OffWriteError("Open Food Facts answered 503")
      );
      await expect(
        contributeProduct(db, product, user.id, failing.d)
      ).resolves.toBe("failed");
      expect((await rows())[0]).toMatchObject({
        status: "failed",
        error: "Open Food Facts answered 503",
        attempts: 1,
      });
      expect((await rows())[0].fields).toMatchObject({ code: product.barcode });
      await expect(getContribution(db, product.barcode)).resolves.toEqual({
        status: "failed",
        retryable: true,
      });

      const working = deps();
      await expect(
        retryContribution(db, product.barcode, user.id, working.d)
      ).resolves.toBe("sent");
      expect(working.write).toHaveBeenCalledTimes(1);
      expect((await rows())[0]).toMatchObject({
        status: "sent",
        error: null,
        attempts: 2,
      });
    });

    it("on retry drops what Open Food Facts gained meanwhile", async () => {
      const user = await alex();
      const failing = deps();
      failing.write.mockRejectedValue(new OffWriteError("nope"));
      const grenade = {
        ...product,
        barcode: offFixtureCode("grenade-multipack"),
      };
      await contributeProduct(db, grenade, user.id, failing.d);
      // The failed attempt saw the full record (nothing known yet): all fields.
      expect((await rows())[0].fields).toHaveProperty("serving_size");

      // By the retry, Open Food Facts has the serving size and the macros too.
      const later = deps({ lookup: offFrom("snickers") });
      await expect(
        retryContribution(db, grenade.barcode, user.id, later.d)
      ).resolves.toBe("nothing");
      expect(later.write).not.toHaveBeenCalled();
    });

    it("keeps a failed lookup as 'failed' too", async () => {
      const user = await alex();
      const { d } = deps({
        lookup: async () => {
          throw new Error("secret detail hunter2-secret");
        },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(contributeProduct(db, product, user.id, d)).resolves.toBe(
        "failed"
      );
      const [row] = await rows();
      expect(row.status).toBe("failed");
      expect(row.error).not.toContain("hunter2-secret");
    });

    it("can retry after the very first lookup failed: the fields are kept from the claim", async () => {
      const user = await alex();
      const down = deps({
        lookup: async () => {
          throw new RetryableError("Open Food Facts isn't answering.");
        },
      });
      await contributeProduct(db, product, user.id, down.d);
      expect((await rows())[0]).toMatchObject({
        status: "failed",
        error: "Open Food Facts isn't answering.",
        fields: expect.objectContaining({
          code: product.barcode,
          product_name: "Chocolate bar",
        }),
      });

      const up = deps();
      await expect(
        retryContribution(db, product.barcode, user.id, up.d)
      ).resolves.toBe("sent");
      expect(up.write.mock.calls[0][0]).toMatchObject({
        product_name: "Chocolate bar",
      });
    });

    it("treats an unreadable Open Food Facts reply as a failure, not an empty record", async () => {
      const user = await alex();
      const { d, write } = deps({
        lookup: () =>
          lookupOpenFoodFacts("5060925291339", {
            fetch: async () => new Response("<html>"),
            strict: true,
          }),
      });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await expect(contributeProduct(db, product, user.id, d)).resolves.toBe(
        "failed"
      );
      expect(write).not.toHaveBeenCalled();
    });

    it("retries an abandoned pending attempt, and reads it as failed", async () => {
      const user = await alex();
      await db.insert(offContributions).values({
        barcode: product.barcode,
        status: "pending",
        fields: { code: product.barcode, product_name: "Chocolate bar" },
        attempts: 1,
        createdBy: user.id,
        updatedAt: new Date(Date.now() - 60 * 60 * 1000),
      });
      await expect(getContribution(db, product.barcode)).resolves.toEqual({
        status: "failed",
        retryable: true,
      });
      const { d } = deps();
      await expect(
        retryContribution(db, product.barcode, user.id, d)
      ).resolves.toBe("sent");
    });

    it("leaves a running attempt alone, to retry and to read", async () => {
      const user = await alex();
      await db.insert(offContributions).values({
        barcode: product.barcode,
        status: "pending",
        fields: { code: product.barcode },
        attempts: 1,
        createdBy: user.id,
      });
      const { d, write } = deps();
      await expect(
        retryContribution(db, product.barcode, user.id, d)
      ).resolves.toBe("skipped");
      expect(write).not.toHaveBeenCalled();
      await expect(getContribution(db, product.barcode)).resolves.toMatchObject(
        { status: "pending", retryable: false }
      );
    });

    it("stops after 5 attempts", async () => {
      const user = await alex();
      for (let i = 0; i < 5; i += 1) {
        const failing = deps();
        failing.write.mockRejectedValue(new OffWriteError("no"));
        await contributeProduct(db, product, user.id, failing.d);
      }
      expect((await rows())[0]).toMatchObject({
        status: "failed",
        attempts: 5,
      });
      await expect(getContribution(db, product.barcode)).resolves.toEqual({
        status: "failed",
        retryable: false,
      });
      const { d, write } = deps();
      await expect(
        retryContribution(db, product.barcode, user.id, d)
      ).resolves.toBe("skipped");
      await expect(contributeProduct(db, product, user.id, d)).resolves.toBe(
        "skipped"
      );
      expect(write).not.toHaveBeenCalled();
    });

    it("retries only a failed one", async () => {
      const user = await alex();
      const sent = deps();
      await contributeProduct(db, product, user.id, sent.d);
      const again = deps();
      await expect(
        retryContribution(db, product.barcode, user.id, again.d)
      ).resolves.toBe("skipped");
      await expect(
        retryContribution(db, "0000000000000", user.id, again.d)
      ).resolves.toBe("skipped");
      expect(again.write).not.toHaveBeenCalled();
    });

    it("doesn't start while another attempt is running", async () => {
      const user = await alex();
      await db.insert(offContributions).values({
        barcode: product.barcode,
        status: "pending",
        attempts: 1,
        createdBy: user.id,
      });
      const { d, write } = deps();
      await expect(contributeProduct(db, product, user.id, d)).resolves.toBe(
        "skipped"
      );
      expect(write).not.toHaveBeenCalled();
    });

    it("takes over a pending attempt that never finished", async () => {
      const user = await alex();
      await db.insert(offContributions).values({
        barcode: product.barcode,
        status: "pending",
        attempts: 1,
        createdBy: user.id,
        updatedAt: new Date(Date.now() - 60 * 60 * 1000),
      });
      const { d } = deps();
      await expect(contributeProduct(db, product, user.id, d)).resolves.toBe(
        "sent"
      );
      expect(
        (
          await db
            .select()
            .from(offContributions)
            .where(eq(offContributions.barcode, product.barcode))
        )[0].attempts
      ).toBe(2);
    });

    it("keeps the row, without an owner, when the user is removed", async () => {
      const user = await alex();
      await contributeProduct(db, product, user.id, deps().d);
      await db.execute(
        (await import("drizzle-orm"))
          .sql`DELETE FROM users WHERE id = ${user.id}`
      );
      expect((await rows())[0].createdBy).toBeNull();
    });
  }
);
