// Copies the barcode reader's wasm from node_modules into public/zxing/, so
// the scanner loads it from our own origin (and the service worker can keep
// it) instead of from jsDelivr. The version is in the file name: a
// zxing-wasm upgrade is a new URL, and src/lib/barcode-scanner.test.ts fails
// if the URL the code asks for and the file written here disagree. The copy
// is gitignored; `dev` and `build` write it.
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Writes the wasm into `outDir` and returns its path. */
export const copyWasm = (outDir = join(root, "public", "zxing")) => {
  const pkg = join(root, "node_modules", "zxing-wasm");
  const { version } = JSON.parse(
    readFileSync(join(pkg, "package.json"), "utf8")
  );
  rmSync(outDir, { recursive: true, force: true }); // no stale versions
  mkdirSync(outDir, { recursive: true });
  const to = join(outDir, `zxing_reader.${version}.wasm`);
  copyFileSync(join(pkg, "dist", "reader", "zxing_reader.wasm"), to);
  return to;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  copyWasm();
}
