import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import manifest from "./manifest";

const publicFile = (src: string) =>
  readFileSync(path.join(__dirname, "../../public", src));

// Width and height sit at bytes 16 and 20 of a PNG's header.
const pngSize = (png: Buffer) =>
  `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;

describe("manifest", () => {
  const m = manifest();

  it("keeps the id installed apps already have", () => {
    // Installs from before the id existed used start_url as theirs.
    expect(m).toMatchObject({
      id: "/week",
      start_url: "/week",
      display: "standalone",
    });
  });

  it("points at icons and screenshots that exist, in the sizes it claims", () => {
    // A wrong size makes Chrome drop the richer install dialog.
    const files = [...m.icons!, ...m.screenshots!];
    expect(
      files.map(({ src }) => `${src} ${pngSize(publicFile(src))}`)
    ).toEqual(files.map(({ src, sizes }) => `${src} ${sizes}`));
    expect(m.screenshots!.map((s) => s.form_factor)).toEqual([
      "narrow",
      "wide",
    ]);
  });

  it("offers the week, the shopping list and adding a recipe as shortcuts", () => {
    expect(m.shortcuts!.map((s) => s.url)).toEqual([
      "/week",
      "/shopping",
      "/recipes/new",
    ]);
  });
});
