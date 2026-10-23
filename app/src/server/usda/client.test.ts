import { describe, expect, it, vi } from "vitest";

import { RetryableError } from "../errors";

import { usdaClient, usdaEnabled } from "./client";
import foodsJson from "./fixtures/foods.json";
import searchJson from "./fixtures/search.json";

const KEY = "fdc-secret-key";
const env = { USDA_FDC_API_KEY: KEY };

type Fetch = typeof fetch;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

/** A fake FDC: answers searches with the fixture and details with the requested foods. */
function fakeFdc() {
  return vi.fn<Fetch>(async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.endsWith("/foods/search")) {
      return json(searchJson);
    }
    return json(
      foodsJson.filter((f) => (body.fdcIds as number[]).includes(f.fdcId))
    );
  });
}

const bodyOf = (call: Parameters<Fetch>) => JSON.parse(String(call[1]?.body));

describe("usdaEnabled", () => {
  it.each([
    [{}, false],
    [{ USDA_FDC_API_KEY: "  " }, false],
    [env, true],
  ])("%j", (e, on) => {
    expect(usdaEnabled(e)).toBe(on);
    expect(usdaClient(e, fakeFdc()) !== null).toBe(on);
  });
});

describe("search", () => {
  it("posts the query to the FDC search over the three data types", async () => {
    const fetchImpl = fakeFdc();

    const hits = await usdaClient(env, fetchImpl)!.search("kiwi raw", 10);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0]!;
    expect(String(call[0])).toBe(
      "https://api.nal.usda.gov/fdc/v1/foods/search"
    );
    expect(call[1]?.method).toBe("POST");
    expect(bodyOf(call)).toEqual({
      query: "kiwi raw",
      dataType: ["Foundation", "SR Legacy", "Survey (FNDDS)"],
      pageSize: 10,
    });
    expect(hits.map((h) => h.fdcId)).toContain(2709239);
  });

  it("sends the key as a header and keeps it out of the URL", async () => {
    const fetchImpl = fakeFdc();

    await usdaClient(env, fetchImpl)!.search("kiwi");

    const call = fetchImpl.mock.calls[0]!;
    expect(new Headers(call[1]?.headers).get("x-api-key")).toBe(KEY);
    expect(String(call[0])).not.toContain(KEY);
    expect(String(call[0])).not.toContain("api_key");
  });
});

describe("foods", () => {
  it("asks for the full format, which carries the portions", async () => {
    const fetchImpl = fakeFdc();

    const foods = await usdaClient(env, fetchImpl)!.foods([169230, 748967]);

    expect(bodyOf(fetchImpl.mock.calls[0]!)).toEqual({
      fdcIds: [169230, 748967],
      format: "full",
    });
    expect(
      new Headers(fetchImpl.mock.calls[0]![1]?.headers).get("x-api-key")
    ).toBe(KEY);
    expect(foods.map((f) => f.fdcId)).toEqual([169230, 748967]);
    expect(foods[0]?.portions.length).toBeGreaterThan(0);
  });

  it("batches ids by 20", async () => {
    const fetchImpl = fakeFdc();
    const known = foodsJson.map((f) => f.fdcId);
    const ids = [
      ...known,
      ...Array.from({ length: 38 }, (_, i) => 9_000_000 + i),
    ];

    const foods = await usdaClient(env, fetchImpl)!.foods(ids);

    expect(fetchImpl.mock.calls.map((c) => bodyOf(c).fdcIds.length)).toEqual([
      20, 20, 5,
    ]);
    expect(foods.map((f) => f.fdcId).sort()).toEqual([...known].sort());
  });

  it("makes no request for no ids", async () => {
    const fetchImpl = fakeFdc();

    await expect(usdaClient(env, fetchImpl)!.foods([])).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("failures", () => {
  const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

  it.each([[429], [500], [503]])("a %d is retryable", async (status) => {
    quiet();
    const fetchImpl = vi.fn<Fetch>(async () => json({}, status));

    await expect(
      usdaClient(env, fetchImpl)!.search("kiwi")
    ).rejects.toBeInstanceOf(RetryableError);
    await expect(usdaClient(env, fetchImpl)!.foods([1])).rejects.toBeInstanceOf(
      RetryableError
    );
  });

  it("a network failure is retryable", async () => {
    quiet();
    const fetchImpl = vi.fn<Fetch>(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(
      usdaClient(env, fetchImpl)!.search("kiwi")
    ).rejects.toBeInstanceOf(RetryableError);
  });

  it.each([[400], [403]])("a %d is an error, not a retry", async (status) => {
    quiet();
    const fetchImpl = vi.fn<Fetch>(async () => json({ error: "no" }, status));

    const err = await usdaClient(env, fetchImpl)!
      .search("kiwi")
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(RetryableError);
  });
});
