import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { MEALIE_SCHEMA_VERSION } from "./client";
import openapi from "./openapi.json";

const root = path.resolve(__dirname, "../../../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

// The Mealie version is written down in several places; upgrading means
// changing all of them (docs/mealie-api.md, "Upgrading Mealie").
describe("Mealie version", () => {
  it("is the same everywhere", () => {
    expect(openapi.info.version).toBe(MEALIE_SCHEMA_VERSION);
    const tag = `mealie:${MEALIE_SCHEMA_VERSION}`;
    expect(read("docker-compose.yml")).toContain(
      `/mealie}:${MEALIE_SCHEMA_VERSION}`
    );
    const ci = read(".github/workflows/ci.yml").match(/mealie:v[\d.]+/g);
    expect(new Set(ci)).toEqual(new Set([tag]));
    expect(read("docs/mealie-api.md")).toContain(`(${MEALIE_SCHEMA_VERSION})`);
  });
});
