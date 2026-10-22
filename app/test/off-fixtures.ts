// Recorded Open Food Facts v3 responses (see test/fixtures/openfoodfacts).
import { readFileSync } from "node:fs";
import path from "node:path";

export type OffFixture =
  | "snickers"
  | "grenade-multipack"
  | "huel-prepared-only"
  | "kind-kj-mismatch"
  | "fage-pot"
  | "coca-cola-can"
  | "walkers-no-serving"
  | "not-found";

export const offFixtureText = (name: OffFixture) =>
  readFileSync(
    path.join(__dirname, "fixtures/openfoodfacts", `${name}.json`),
    "utf8"
  );

export const offFixtureJson = (name: OffFixture): Record<string, unknown> =>
  JSON.parse(offFixtureText(name)) as Record<string, unknown>;

/** The barcode each fixture was recorded for. */
export const offFixtureCode = (name: OffFixture) =>
  String(offFixtureJson(name).code);
