import { describe, expect, it } from "vitest";

import { expandUpcE, parseBarcode } from "./barcode";

describe("parseBarcode", () => {
  it("accepts a valid EAN-13 and EAN-8 unchanged", () => {
    expect(parseBarcode("5000159461122")).toBe("5000159461122");
    expect(parseBarcode("4006381333931")).toBe("4006381333931");
    expect(parseBarcode("73513537")).toBe("73513537");
  });

  it("pads a UPC-A to 13 digits so it shares a key with its EAN-13", () => {
    expect(parseBarcode("036000291452")).toBe("0036000291452");
    expect(parseBarcode("0036000291452")).toBe("0036000291452");
  });

  it("drops the leading 0 of a GTIN-14, and keeps any other GTIN-14", () => {
    expect(parseBarcode("05000159461122")).toBe("5000159461122");
    expect(parseBarcode("15000159461129")).toBe("15000159461129");
  });

  it("ignores spaces and hyphens", () => {
    expect(parseBarcode(" 5000 1594-6112 2 ")).toBe("5000159461122");
    expect(parseBarcode("0-36000-29145-2")).toBe("0036000291452");
  });

  it("rejects a wrong check digit", () => {
    expect(parseBarcode("5000159461123")).toBeNull();
    expect(parseBarcode("73513538")).toBeNull();
    expect(parseBarcode("036000291453")).toBeNull();
  });

  it("rejects letters and other characters", () => {
    expect(parseBarcode("50001594611A2")).toBeNull();
    expect(parseBarcode("5000159461122x")).toBeNull();
    expect(parseBarcode("5000.159461122")).toBeNull();
    expect(parseBarcode("")).toBeNull();
    expect(parseBarcode("   ")).toBeNull();
  });

  it("rejects lengths other than 8, 12, 13 and 14", () => {
    expect(parseBarcode("7351353")).toBeNull(); // 7
    expect(parseBarcode("500015946")).toBeNull(); // 9
    expect(parseBarcode("500015946112")).toBeNull(); // 12, bad check digit
    expect(parseBarcode("050001594611220")).toBeNull(); // 15
  });

  it("rejects all-zero codes, though their check digit is valid", () => {
    expect(parseBarcode("00000000")).toBeNull();
    expect(parseBarcode("000000000000")).toBeNull();
    expect(parseBarcode("0000000000000")).toBeNull();
    expect(parseBarcode("00000000000000")).toBeNull();
  });
});

describe("expandUpcE", () => {
  it("expands each UPC-E pattern to the UPC-A key a 13-digit read gives", () => {
    expect(expandUpcE("04963406")).toBe("0049000006346");
    expect(expandUpcE("04252614")).toBe("0042100005264");
    expect(expandUpcE("01234531")).toBe("0012300000451");
    expect(expandUpcE("01234543")).toBe("0012340000053");
    expect(expandUpcE("01234565")).toBe("0012345000065");
  });

  it("refuses a wrong check digit, another number system or length", () => {
    expect(expandUpcE("04963407")).toBeNull();
    expect(expandUpcE("24963406")).toBeNull();
    expect(expandUpcE("0496340")).toBeNull();
    expect(expandUpcE("0049000006346")).toBeNull();
  });
});
