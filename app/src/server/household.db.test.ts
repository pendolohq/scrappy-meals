import { describe, expect, it } from "vitest";

import { testDbUrl, useTestDb } from "../../test/db";

import { getSnackSlots, HouseholdError, setSnackSlots } from "./household";

describe.skipIf(!testDbUrl)("household (Postgres)", () => {
  const db = useTestDb();

  it("defaults to 2 snack slots when nothing has been saved", async () => {
    expect(await getSnackSlots(db)).toBe(2);
  });

  it("saves a count and reads it back, replacing the previous one", async () => {
    await setSnackSlots(db, 4);
    expect(await getSnackSlots(db)).toBe(4);
    await setSnackSlots(db, 0);
    expect(await getSnackSlots(db)).toBe(0);
  });

  it.each([-1, 5, 1.5, Number.NaN])("rejects %s", async (count) => {
    await expect(setSnackSlots(db, count)).rejects.toBeInstanceOf(
      HouseholdError
    );
    expect(await getSnackSlots(db)).toBe(2);
  });
});
