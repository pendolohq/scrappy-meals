// Reads barcodes off the main thread: a frame takes zxing tens of ms on a
// phone, which would stall the dialog 6 times a second. One wasm module for
// the worker's life; a worker whose wasm failed to load is thrown away.
import {
  prepareZXingModule,
  readBarcodes,
  ZXING_WASM_VERSION,
} from "zxing-wasm/reader";

import { READER_OPTIONS, toDetections, wasmUrl } from "./zxing";

export type WorkerRequest = { id: number; bitmap: ImageBitmap };
export type WorkerReply =
  | { id: number; detections: { rawValue: string; format: string }[] }
  | { id: number; error: "unavailable" | "unreadable" };

const ready = prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith(".wasm")
        ? new URL(wasmUrl(ZXING_WASM_VERSION), self.location.origin).href
        : prefix + path,
  },
  fireImmediately: true,
});
// Reported per request below; this only keeps it from counting as unhandled.
ready.catch(() => undefined);

const pixels = (bitmap: ImageBitmap) => {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("no 2d context");
  }
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
};

// The DOM lib types `self` as a window, whose postMessage wants an origin; this
// file only runs as a worker, where it takes none.
const reply = (message: WorkerReply) =>
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  (self as unknown as Worker).postMessage(message);

self.addEventListener("message", async (e: MessageEvent<WorkerRequest>) => {
  const { id, bitmap } = e.data;
  try {
    await ready;
  } catch {
    bitmap.close();
    reply({ id, error: "unavailable" });
    return;
  }
  try {
    const image = pixels(bitmap);
    reply({
      id,
      detections: toDetections(await readBarcodes(image, READER_OPTIONS)),
    });
  } catch {
    reply({ id, error: "unreadable" });
  } finally {
    bitmap.close();
  }
});
