import {
  ZXING_WASM_SHA256,
  ZXING_WASM_VERSION,
} from "barcode-detector/ponyfill";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { copyWasm } from "../../scripts/copy-wasm.mjs";

import {
  SCAN_FORMATS,
  confirmRead,
  createDetector,
  isScannerFailure,
  wasmUrl,
  type DetectorClass,
} from "./barcode-scanner";

const fakeClass = (supported?: string[]) => {
  const ctor = vi.fn<(options: { formats: string[] }) => void>();
  const Class = class {
    static getSupportedFormats =
      supported === undefined ? undefined : async () => supported;
    constructor(options: { formats: string[] }) {
      ctor(options);
    }
    detect = async () => [];
  };
  return { Class: Class as unknown as DetectorClass, ctor };
};

describe("createDetector", () => {
  it("uses the native detector when it reads EAN-13", async () => {
    const native = fakeClass(["qr_code", "ean_13"]);
    const ponyfill = fakeClass();
    const load = vi.fn<() => Promise<DetectorClass>>(
      async () => ponyfill.Class
    );
    await createDetector({ native: native.Class, load });
    expect(load).not.toHaveBeenCalled();
    expect(native.ctor).toHaveBeenCalledWith({ formats: SCAN_FORMATS });
  });

  it("loads the ponyfill when the native one lacks EAN-13", async () => {
    const native = fakeClass(["qr_code"]);
    const ponyfill = fakeClass();
    await createDetector({
      native: native.Class,
      load: async () => ponyfill.Class,
    });
    expect(native.ctor).not.toHaveBeenCalled();
    expect(ponyfill.ctor).toHaveBeenCalledWith({ formats: SCAN_FORMATS });
  });

  it("loads the ponyfill when there is no native detector", async () => {
    const ponyfill = fakeClass();
    await createDetector({
      native: undefined,
      load: async () => ponyfill.Class,
    });
    expect(ponyfill.ctor).toHaveBeenCalledTimes(1);
  });

  it("falls back when the native detector can't list its formats", async () => {
    const native = fakeClass(["ean_13"]);
    native.Class.getSupportedFormats = async () => {
      throw new Error("broken");
    };
    const ponyfill = fakeClass();
    await createDetector({
      native: native.Class,
      load: async () => ponyfill.Class,
    });
    expect(ponyfill.ctor).toHaveBeenCalledTimes(1);
  });
});

describe("confirmRead", () => {
  const SNICKERS = "5000159461122";

  it("needs the same barcode twice in a row", () => {
    const first = confirmRead(null, [SNICKERS]);
    expect(first).toEqual({ previous: SNICKERS, confirmed: null });
    expect(confirmRead(first.previous, [SNICKERS]).confirmed).toBe(SNICKERS);
  });

  it("starts over when the code changes or nothing valid is seen", () => {
    expect(confirmRead(SNICKERS, ["4006381333931"]).confirmed).toBeNull();
    expect(confirmRead(SNICKERS, []).previous).toBeNull();
    // A misread digit fails the check digit.
    expect(confirmRead(SNICKERS, ["5000159461123"])).toEqual({
      previous: null,
      confirmed: null,
    });
  });

  it("treats UPC-A and its EAN-13 form as one product", () => {
    const upc = "036000291452";
    expect(confirmRead("0036000291452", [upc]).confirmed).toBe("0036000291452");
  });
});

describe("self-hosted wasm", () => {
  it("is written where the code points, and is the one the library expects", () => {
    const dir = mkdtempSync(join(tmpdir(), "zxing-"));
    try {
      const written = copyWasm(dir);
      expect(written).toBe(
        join(dir, wasmUrl(ZXING_WASM_VERSION).split("/")[2])
      );
      const sha = createHash("sha256")
        .update(readFileSync(written))
        .digest("hex");
      expect(sha).toBe(ZXING_WASM_SHA256);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("isScannerFailure", () => {
  it("is the ponyfill's NotSupportedError only", () => {
    expect(
      isScannerFailure(new DOMException("unavailable", "NotSupportedError"))
    ).toBe(true);
    expect(isScannerFailure(new DOMException("x", "InvalidStateError"))).toBe(
      false
    );
    expect(isScannerFailure(new Error("NotSupportedError"))).toBe(false);
    expect(isScannerFailure(undefined)).toBe(false);
  });
});
