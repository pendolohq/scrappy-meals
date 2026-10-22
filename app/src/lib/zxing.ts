import type { ReaderOptions, ReadResult } from "zxing-wasm/reader";

/** Where scripts/copy-wasm.mjs puts the reader wasm (the version is in its name). */
export const wasmUrl = (version: string) =>
  `/zxing/zxing_reader.${version}.wasm`;

/**
 * Retail codes only. Packs are scanned sideways as often as not, so rotation
 * stays on; they are never printed light on dark, so inversion, which costs a
 * second pass over every frame, is off.
 */
export const READER_OPTIONS: ReaderOptions = {
  formats: ["EAN13", "EAN8", "UPCA", "UPCE"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: false,
  tryDownscale: true,
  maxNumberOfSymbols: 4,
};

// zxing's names, as the browser's BarcodeDetector spells them.
const FORMATS: Record<string, string> = {
  EAN13: "ean_13",
  EAN8: "ean_8",
  UPCA: "upc_a",
  UPCE: "upc_e",
};

export const toDetections = (results: ReadResult[]) =>
  results.flatMap((r) =>
    r.isValid && FORMATS[r.format]
      ? [{ rawValue: r.text, format: FORMATS[r.format] }]
      : []
  );
