import { build } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { options } from "../../scripts/build-cli.mjs";

const app = path.resolve(__dirname, "../..");
const patterns = readFileSync(path.join(app, "../.github/image-paths"), "utf8")
  .split("\n")
  .filter((line) => line.trim() && !line.startsWith("#"))
  .map((line) => new RegExp(`^${line.trim()}`));

// A pull request only builds the image when it touches .github/image-paths.
// Our own code bundled into the CLI and the migrator is part of the image, so
// it must be listed there, or a change to it could ship a broken image.
describe("the image build filter", () => {
  it("covers every file bundled into the CLI and the migrator", async () => {
    const result = await build({
      ...options,
      absWorkingDir: app,
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    const ours = Object.keys(result.metafile?.inputs ?? {})
      .filter((f) => !f.includes("node_modules"))
      .map((f) => `app/${f}`);
    expect(ours.length).toBeGreaterThan(3);
    expect(ours.filter((f) => !patterns.some((p) => p.test(f)))).toEqual([]);
  }, 30_000);
});
