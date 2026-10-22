import { afterEach, describe, expect, it, vi } from "vitest";

import {
  offAccount,
  offAppUuid,
  OffWriteError,
  writeOpenFoodFacts,
} from "./openfoodfacts";

type Fetch = typeof fetch;

const account = { userId: "scrappy-app", password: "hunter2-secret" };
const fields = {
  code: "5060925291339",
  comment: "Added from Scrappy Meals",
  product_name: "Huel bar & more",
  "nutriment_energy-kcal": "364",
};

const reply = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
  });
const saved = () => reply({ status: 1, status_verbose: "fields saved" });

const write = (
  fetcher: Fetch,
  sleep = vi.fn<(ms: number) => Promise<void>>(async () => {})
) => writeOpenFoodFacts(fields, account, "uuid-1", { fetch: fetcher, sleep });

describe("writeOpenFoodFacts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts the fields and the credentials as a form, with our User-Agent", async () => {
    const fetcher = vi.fn<Fetch>(async () => saved());
    await write(fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(
      "https://world.openfoodfacts.org/cgi/product_jqm2.pl"
    );
    expect(init?.method).toBe("POST");
    // The credentials are in the body: a redirect must fail, not be followed.
    expect(init?.redirect).toBe("error");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(headers["User-Agent"]).toMatch(/^ScrappyMeals\/\S+ \(\+https:/);

    const sent = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(sent)).toEqual({
      ...fields,
      user_id: "scrappy-app",
      password: "hunter2-secret",
      app_name: "ScrappyMeals",
      app_version: "1.0",
      app_uuid: "uuid-1",
    });
    // Encoded, not interpolated.
    expect(String(init?.body)).toContain("product_name=Huel+bar+%26+more");
  });

  it("retries once, after a pause, on a 503 and succeeds", async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const fetcher = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(reply("busy", 503))
      .mockResolvedValueOnce(saved());
    await write(fetcher, sleep);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("retries once on a network error and on a 429, then gives up", async () => {
    const network = vi
      .fn<Fetch>()
      .mockRejectedValue(new TypeError("fetch failed"));
    await expect(write(network)).rejects.toThrow(
      "Open Food Facts could not be reached"
    );
    expect(network).toHaveBeenCalledTimes(2);

    const limited = vi.fn<Fetch>(async () => reply("", 429));
    await expect(write(limited)).rejects.toThrow("answered 429");
    expect(limited).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400, or a refusal in a 200", async () => {
    const bad = vi.fn<Fetch>(async () => reply("no", 400));
    await expect(write(bad)).rejects.toThrow("answered 400");
    expect(bad).toHaveBeenCalledTimes(1);

    const refused = vi.fn<Fetch>(async () =>
      reply({ status: 0, status_verbose: "Invalid user" })
    );
    await expect(write(refused)).rejects.toThrow(
      "Open Food Facts didn't save it: Invalid user"
    );
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("treats an unreadable 200 as a failure", async () => {
    await expect(
      write(vi.fn<Fetch>(async () => reply("<html>")))
    ).rejects.toBeInstanceOf(OffWriteError);
  });

  it("keeps the password out of errors and logs", async () => {
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const echo = vi.fn<Fetch>(async () =>
      reply({ status: 0, status_verbose: "bad password hunter2-secret" })
    );
    const failure = await write(echo).catch((err: unknown) => err);
    expect(String(failure)).not.toContain("hunter2-secret");
    for (const spy of [log, warn, error]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain("hunter2-secret");
    }
  });
});

describe("offAccount", () => {
  it("is on only when both variables are set", () => {
    expect(offAccount({})).toBeNull();
    expect(offAccount({ OFF_USER_ID: "a" })).toBeNull();
    expect(offAccount({ OFF_PASSWORD: "b" })).toBeNull();
    expect(offAccount({ OFF_USER_ID: "", OFF_PASSWORD: "b" })).toBeNull();
    expect(offAccount({ OFF_USER_ID: "a", OFF_PASSWORD: "b" })).toEqual({
      userId: "a",
      password: "b",
    });
  });
});

describe("offAppUuid", () => {
  const alex = "7b0c1c9e-4c1a-4f55-9a0e-2f4d8d6f2a10";
  const sam = "0e1f5c2d-9c1b-4a77-8f0d-3a6b1c5e9d21";

  it("is stable per user and per secret", () => {
    expect(offAppUuid(alex, "secret")).toBe(offAppUuid(alex, "secret"));
    expect(offAppUuid(alex, "secret")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("differs across users and across secrets, and never contains the user id", () => {
    expect(offAppUuid(alex, "secret")).not.toBe(offAppUuid(sam, "secret"));
    expect(offAppUuid(alex, "secret")).not.toBe(offAppUuid(alex, "other"));
    expect(offAppUuid(alex, "secret")).not.toContain(alex.slice(0, 8));
  });
});
