import { parseBarcode } from "@/server/domain/barcode";

/** What packs carry: EAN-13 and 8, and the UPC forms of US imports. */
export const SCAN_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

export type Detector = {
  detect: (image: ImageBitmapSource) => Promise<{ rawValue: string }[]>;
};

export type DetectorClass = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<readonly string[]>;
};

/** Where scripts/copy-wasm.mjs puts the reader wasm (the version is in its name). */
export const wasmUrl = (version: string) =>
  `/zxing/zxing_reader.${version}.wasm`;

const loadPonyfill = async (): Promise<DetectorClass> => {
  // Imported here so only the scanner pays for it (about 1 MB of wasm).
  const {
    BarcodeDetector,
    ZXING_WASM_VERSION,
    prepareZXingModule,
    purgeZXingModule,
  } = await import("barcode-detector/ponyfill");
  // A retry after a failed load must not reuse the rejected module promise.
  purgeZXingModule();
  prepareZXingModule({
    overrides: {
      locateFile: (path, prefix) =>
        path.endsWith(".wasm") ? wasmUrl(ZXING_WASM_VERSION) : prefix + path,
    },
  });
  return BarcodeDetector as unknown as DetectorClass;
};

/**
 * The browser's own detector when it reads EAN-13 (Chrome on Android), else
 * the wasm one. Safari ships a flagged, broken version, so "exists" isn't
 * enough.
 */
export const createDetector = async ({
  native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector,
  load = loadPonyfill,
}: {
  native?: DetectorClass;
  load?: () => Promise<DetectorClass>;
} = {}): Promise<Detector> => {
  let Class: DetectorClass | undefined;
  if (native?.getSupportedFormats) {
    const supported: readonly string[] = await native
      .getSupportedFormats()
      .catch(() => []);
    if (supported.includes("ean_13")) {
      Class = native;
    }
  }
  Class ??= await load();
  return new Class({ formats: SCAN_FORMATS });
};

/**
 * A single frame can misread a digit, so a code counts only when two
 * detections in a row give the same barcode. `previous` is the last valid
 * one (canonical, so UPC-A and EAN-13 of one product agree).
 */
export const confirmRead = (
  previous: string | null,
  rawValues: string[]
): { previous: string | null; confirmed: string | null } => {
  const code = rawValues.map(parseBarcode).find((c) => c !== null) ?? null;
  return {
    previous: code,
    confirmed: code !== null && code === previous ? code : null,
  };
};

/** The ponyfill throws this on every call when its wasm didn't load. */
export const isScannerFailure = (e: unknown) =>
  e instanceof DOMException && e.name === "NotSupportedError";

const MAX_PHOTO_EDGE = 2048;

/**
 * The photo as a bitmap, shrunk to MAX_PHOTO_EDGE on its long side: a 12 MP
 * phone picture is slow to decode and no easier to read.
 */
export const loadPhoto = async (file: Blob): Promise<ImageBitmap> => {
  const full = await createImageBitmap(file);
  const long = Math.max(full.width, full.height);
  if (long <= MAX_PHOTO_EDGE) {
    return full;
  }
  try {
    const wide = full.width >= full.height;
    return await createImageBitmap(full, {
      ...(wide
        ? { resizeWidth: MAX_PHOTO_EDGE }
        : { resizeHeight: MAX_PHOTO_EDGE }),
      resizeQuality: "high",
    });
  } finally {
    full.close();
  }
};
