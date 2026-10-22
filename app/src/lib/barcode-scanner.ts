import { expandUpcE, parseBarcode } from "@/server/domain/barcode";

import type { WorkerReply, WorkerRequest } from "./barcode-worker";

/** What packs carry: EAN-13 and 8, and the UPC forms of US imports. */
export const SCAN_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

/** A barcode as read, with its format in BarcodeDetector's names. */
export type Detection = { rawValue: string; format: string };

export type DetectorClass = {
  new (options: { formats: string[] }): {
    detect: (image: ImageBitmapSource) => Promise<Detection[]>;
  };
  getSupportedFormats?: () => Promise<readonly string[]>;
};

export type Reader = {
  detect: (image: HTMLVideoElement | ImageBitmap) => Promise<Detection[]>;
  /** The browser's own detector, rather than the wasm one. */
  native: boolean;
  close: () => void;
};

/**
 * The first barcode among the detections, canonical. An 8-digit UPC-E is
 * expanded to its UPC-A first: read as an EAN-8 it would fail the check digit
 * or land on a different key from a 13-digit read of the same pack.
 */
export const firstBarcode = (detections: Detection[]): string | null => {
  for (const { rawValue, format } of detections) {
    const code =
      format === "upc_e" && rawValue.length === 8
        ? expandUpcE(rawValue)
        : parseBarcode(rawValue);
    if (code !== null) {
      return code;
    }
  }
  return null;
};

/**
 * A single frame can misread a digit, so a code counts only when two
 * detections in a row give the same barcode. `previous` is the last valid
 * one (canonical, so UPC-A and EAN-13 of one product agree).
 */
export const confirmRead = (
  previous: string | null,
  detections: Detection[]
): { previous: string | null; confirmed: string | null } => {
  const code = firstBarcode(detections);
  return {
    previous: code,
    confirmed: code !== null && code === previous ? code : null,
  };
};

/**
 * A failure every later read would repeat: the native detector's service is
 * missing (Android without Play Services), or the wasm didn't load.
 */
export const isScannerFailure = (e: unknown) =>
  e instanceof DOMException && e.name === "NotSupportedError";

const unavailable = () =>
  new DOMException("The barcode reader isn't available", "NotSupportedError");

/** The wasm reader in a worker; `detect` hands it a frame at a time. */
const workerReader = (): Reader => {
  const worker = new Worker(new URL("./barcode-worker.ts", import.meta.url), {
    type: "module",
  });
  const pending = new Map<
    number,
    { resolve: (d: Detection[]) => void; reject: (e: unknown) => void }
  >();
  let next = 0;
  const failAll = (error: unknown) => {
    pending.forEach((p) => p.reject(error));
    pending.clear();
  };
  worker.addEventListener("message", (e: MessageEvent<WorkerReply>) => {
    const reply = e.data;
    const waiting = pending.get(reply.id);
    pending.delete(reply.id);
    if (!waiting) {
      return;
    }
    if ("detections" in reply) {
      waiting.resolve(reply.detections);
    } else if (reply.error === "unavailable") {
      waiting.reject(unavailable());
    } else {
      waiting.reject(new Error("Unreadable frame"));
    }
  });
  // The worker script itself didn't load (offline on the first scan).
  worker.addEventListener("error", () => failAll(unavailable()));
  return {
    native: false,
    detect: async (image) => {
      const bitmap =
        image instanceof ImageBitmap ? image : await createImageBitmap(image);
      const id = next++;
      return new Promise<Detection[]>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const request: WorkerRequest = { id, bitmap };
        worker.postMessage(request, [bitmap]);
      });
    },
    close: () => {
      worker.terminate();
      failAll(unavailable());
    },
  };
};

/**
 * The browser's own detector when it reads EAN-13 (Chrome on Android), else
 * the wasm one. Safari ships a flagged, broken version, so "exists" isn't
 * enough.
 */
export const createReader = async ({
  native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector,
  wasm = workerReader,
}: {
  /** null: don't use one even if the browser has it. */
  native?: DetectorClass | null;
  wasm?: () => Reader;
} = {}): Promise<Reader> => {
  if (native?.getSupportedFormats) {
    const supported: readonly string[] = await native
      .getSupportedFormats()
      .catch(() => []);
    if (supported.includes("ean_13")) {
      const detector = new native({ formats: SCAN_FORMATS });
      return {
        native: true,
        detect: (image) => detector.detect(image),
        close: () => undefined,
      };
    }
  }
  return wasm();
};

/**
 * One reader for the page, made when first needed and kept across scans so
 * the wasm compiles once. After a failure every read would repeat, `drop`
 * forgets it so the next scan starts over, and never goes back to a native
 * detector that failed: the wasm one reads where it can't.
 */
export const createReaderSource = (
  deps: Parameters<typeof createReader>[0] = {}
) => {
  let current: Promise<Reader> | undefined;
  let nativeFailed = false;
  return {
    get: (): Promise<Reader> =>
      (current ??= createReader(
        nativeFailed ? { ...deps, native: null } : deps
      )),
    /** `reader` is what `loading` gave, when it gave anything. */
    drop: (loading: Promise<Reader>, reader?: Reader) => {
      if (reader?.native) {
        nativeFailed = true;
      }
      // A newer reader may have replaced this one already.
      if (current === loading) {
        current = undefined;
        reader?.close();
      }
    },
  };
};

const BLOCKED =
  "Camera blocked: allow it in the browser's settings, or take a photo / type the digits.";
const NO_CAMERA = "No camera found: take a photo or type the digits.";
const CAMERA_FAILED =
  "The camera wouldn't start: take a photo or type the digits.";

/** What to tell the person when getUserMedia refuses. */
export const cameraProblem = (e: unknown) => {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return BLOCKED;
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return NO_CAMERA;
  }
  return CAMERA_FAILED;
};

/**
 * The back camera at up to 1080p: at the default 640x480 a 37 mm EAN-13 held
 * where a phone can focus gets under 2 px a bar. Ideal, not exact, so a lesser
 * camera still starts.
 */
export const CAMERA: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
};

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
