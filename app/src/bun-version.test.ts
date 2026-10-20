import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import pkg from "../package.json";

// CI installs the Bun in packageManager; the image copies Bun from its own
// tag, which Dependabot bumps on its own. Bump both together.
describe("Bun version", () => {
  it("is the same in package.json and the Dockerfile", () => {
    const dockerfile = readFileSync(
      path.resolve(__dirname, "../Dockerfile"),
      "utf8"
    );
    const image = dockerfile.match(/oven\/bun:([\d.]+)-/)?.[1];
    expect(pkg.packageManager).toBe(`bun@${image}`);
  });
});
