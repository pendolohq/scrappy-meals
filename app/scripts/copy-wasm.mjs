// Copies the barcode reader's wasm from zxing-wasm into public/zxing/, so the
// scanner loads it from our own origin (and the service worker can keep it)
// instead of from jsDelivr. The version is in the file name: a zxing-wasm
// upgrade is a new URL, and src/lib/barcode-scanner.test.ts fails if the URL
// the worker asks for and the file written here disagree. The copy is
// gitignored; `dev` and `build` write it, and fail if they can't.
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(import.meta.url);
const root = join(dirname(here), "..");

/** Writes the wasm into `outDir` and returns its path. */
export const copyWasm = async (outDir = join(root, "public", "zxing")) => {
  // Through the package's exports, wherever the install put it.
  const from = createRequire(join(root, "package.json")).resolve(
    "zxing-wasm/reader/zxing_reader.wasm"
  );
  const { ZXING_WASM_VERSION, ZXING_WASM_SHA256 } =
    await import("zxing-wasm/reader");
  const sha = createHash("sha256").update(readFileSync(from)).digest("hex");
  if (sha !== ZXING_WASM_SHA256) {
    throw new Error(
      `${from} isn't the wasm zxing-wasm ${ZXING_WASM_VERSION} expects`
    );
  }
  rmSync(outDir, { recursive: true, force: true }); // no stale versions
  mkdirSync(outDir, { recursive: true });
  const to = join(outDir, `zxing_reader.${ZXING_WASM_VERSION}.wasm`);
  copyFileSync(from, to);
  return to;
};

// realpath on both sides: run through a symlink, the paths differ as given.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(here)) {
  await copyWasm();
}
