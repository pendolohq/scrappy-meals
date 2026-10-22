import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  type ReadResult,
  ZXING_WASM_SHA256,
  ZXING_WASM_VERSION,
} from "zxing-wasm/reader";

import { copyWasm } from "../../scripts/copy-wasm.mjs";

import {
  cameraProblem,
  confirmRead,
  createReader,
  createReaderSource,
  type Detection,
  type DetectorClass,
  firstBarcode,
  isScannerFailure,
  type Reader,
  SCAN_FORMATS,
} from "./barcode-scanner";
import { toDetections, wasmUrl } from "./zxing";

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

const fakeWasm = () => {
  const reader: Reader = {
    native: false,
    detect: async () => [],
    close: vi.fn<() => void>(),
  };
  return { reader, make: vi.fn<() => Reader>(() => reader) };
};

describe("createReader", () => {
  it("uses the native detector when it reads EAN-13", async () => {
    const native = fakeClass(["qr_code", "ean_13"]);
    const wasm = fakeWasm();
    const reader = await createReader({
      native: native.Class,
      wasm: wasm.make,
    });
    expect(reader.native).toBe(true);
    expect(wasm.make).not.toHaveBeenCalled();
    expect(native.ctor).toHaveBeenCalledWith({ formats: SCAN_FORMATS });
  });

  it("uses the wasm reader when the native one lacks EAN-13, is missing or can't list its formats", async () => {
    const broken = fakeClass(["ean_13"]);
    broken.Class.getSupportedFormats = async () => {
      throw new Error("broken");
    };
    for (const native of [
      fakeClass(["qr_code"]).Class,
      undefined,
      broken.Class,
    ]) {
      const wasm = fakeWasm();
      expect(await createReader({ native, wasm: wasm.make })).toBe(wasm.reader);
    }
  });
});

describe("createReaderSource", () => {
  it("keeps one reader until it is dropped", async () => {
    const wasm = fakeWasm();
    const source = createReaderSource({ native: null, wasm: wasm.make });
    const first = source.get();
    expect(source.get()).toBe(first);
    source.drop(first, await first);
    expect(wasm.reader.close).toHaveBeenCalledTimes(1);
    expect(source.get()).not.toBe(first);
    expect(wasm.make).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale drop that would throw away a newer reader", async () => {
    const wasm = fakeWasm();
    const source = createReaderSource({ native: null, wasm: wasm.make });
    const old = source.get();
    source.drop(old, await old);
    const fresh = source.get();
    source.drop(old, await old);
    expect(source.get()).toBe(fresh);
  });

  it("falls back to the wasm reader for good once the browser's own one fails", async () => {
    const native = fakeClass(["ean_13"]);
    vi.stubGlobal("BarcodeDetector", native.Class);
    try {
      const wasm = fakeWasm();
      const source = createReaderSource({ wasm: wasm.make });
      const first = source.get();
      expect((await first).native).toBe(true);
      source.drop(first, await first);
      expect(await source.get()).toBe(wasm.reader);
      expect(native.ctor).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

const ean = (rawValue: string): Detection => ({ rawValue, format: "ean_13" });

describe("firstBarcode", () => {
  it("gives the first valid barcode, canonical", () => {
    expect(
      firstBarcode([
        ean("5000159461123"),
        { rawValue: "036000291452", format: "upc_a" },
      ])
    ).toBe("0036000291452");
    expect(firstBarcode([])).toBeNull();
  });

  it("expands an 8-digit UPC-E to the key a 13-digit read of the pack gives", () => {
    expect(firstBarcode([{ rawValue: "04963406", format: "upc_e" }])).toBe(
      "0049000006346"
    );
    expect(firstBarcode([{ rawValue: "0049000006346", format: "upc_e" }])).toBe(
      "0049000006346"
    );
    // The same digits as an EAN-8 stay an EAN-8 (and this one isn't valid).
    expect(
      firstBarcode([{ rawValue: "04963406", format: "ean_8" }])
    ).toBeNull();
  });
});

describe("confirmRead", () => {
  const SNICKERS = ean("5000159461122");

  it("needs the same barcode twice in a row", () => {
    const first = confirmRead(null, [SNICKERS]);
    expect(first).toEqual({ previous: "5000159461122", confirmed: null });
    expect(confirmRead(first.previous, [SNICKERS]).confirmed).toBe(
      "5000159461122"
    );
  });

  it("starts over when the code changes or nothing valid is seen", () => {
    expect(
      confirmRead("5000159461122", [ean("4006381333931")]).confirmed
    ).toBeNull();
    expect(confirmRead("5000159461122", []).previous).toBeNull();
    // A misread digit fails the check digit.
    expect(confirmRead("5000159461122", [ean("5000159461123")])).toEqual({
      previous: null,
      confirmed: null,
    });
  });

  it("treats UPC-A and its EAN-13 form as one product", () => {
    expect(
      confirmRead("0036000291452", [
        { rawValue: "036000291452", format: "upc_a" },
      ]).confirmed
    ).toBe("0036000291452");
  });
});

describe("toDetections", () => {
  const result = (over: Partial<ReadResult>) =>
    ({ isValid: true, text: "", format: "EAN13", ...over }) as ReadResult;

  it("maps zxing's formats to BarcodeDetector's and drops anything else", () => {
    expect(
      toDetections([
        result({ text: "5000159461122" }),
        result({ text: "04963406", format: "UPCE" }),
        result({ text: "x", format: "QRCode" }),
        result({ text: "5000159461122", isValid: false }),
      ])
    ).toEqual([
      { rawValue: "5000159461122", format: "ean_13" },
      { rawValue: "04963406", format: "upc_e" },
    ]);
  });
});

describe("cameraProblem", () => {
  const error = (name: string) => new DOMException("x", name);

  it("says what to do for each way the camera can refuse", () => {
    expect(cameraProblem(error("NotAllowedError"))).toMatch(/^Camera blocked/);
    expect(cameraProblem(error("SecurityError"))).toMatch(/^Camera blocked/);
    expect(cameraProblem(error("NotFoundError"))).toMatch(/^No camera found/);
    expect(cameraProblem(error("OverconstrainedError"))).toMatch(
      /^No camera found/
    );
    expect(cameraProblem(error("NotReadableError"))).toMatch(/wouldn't start/);
    expect(cameraProblem(new Error("?"))).toMatch(/wouldn't start/);
  });
});

describe("self-hosted wasm", () => {
  it("is written where the worker points, and is the one the library expects", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zxing-"));
    try {
      const written = await copyWasm(dir);
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
  it("is a NotSupportedError only", () => {
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
