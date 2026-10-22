import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type OffFixture,
  offFixtureJson,
  offFixtureText,
} from "../../test/off-fixtures";

import { RetryableError, UserFacingError } from "./errors";
import { lookupOpenFoodFacts } from "./openfoodfacts";

type Fetch = typeof fetch;

const json = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const fixture = (name: OffFixture, status = 200) =>
  json(offFixtureText(name), status);

/** A fetch that answers every call with `make()`. */
const answering = (make: () => Response | Promise<Response>) =>
  vi.fn<Fetch>(async () => make());

const lookup = (name: OffFixture, code = "5000159461122") =>
  lookupOpenFoodFacts(code, { fetch: answering(() => fixture(name)) });

/** The product of a found result; fails the test otherwise. */
const foundProduct = (
  result: Awaited<ReturnType<typeof lookupOpenFoodFacts>>
) => {
  if (result.status !== "found") {
    throw new Error("expected the product to be found");
  }
  return result.product;
};

/** A found response with only the given product fields. */
const productBody = (product: Record<string, unknown>) => ({
  code: "5000159461122",
  status: "success",
  result: { id: "product_found" },
  product,
});

describe("lookupOpenFoodFacts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks the v3 endpoint for a fixed field list, with a User-Agent and a timeout", async () => {
    const fetcher = answering(() => fixture("snickers"));
    await lookupOpenFoodFacts("5000159461122", { fetch: fetcher });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(
      "https://world.openfoodfacts.org/api/v3/product/5000159461122?fields=product_name,brands,quantity,product_quantity,product_quantity_unit,serving_quantity,serving_quantity_unit,serving_size,nutrition_data_per,no_nutrition_data,nutriments"
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("user-agent")).toBe(
      "ScrappyMeals/1.0 (+https://github.com/pendolohq/scrappy-meals)"
    );
    expect(headers.get("accept")).toBe("application/json");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("encodes the barcode into the path", async () => {
    const fetcher = answering(() => fixture("not-found", 404));
    await lookupOpenFoodFacts("1/2?x", { fetch: fetcher });
    expect(String(fetcher.mock.calls[0][0])).toContain(
      "/api/v3/product/1%2F2%3Fx?"
    );
  });

  it("reads Snickers: a serving equal to the pack, all five macros per 100 g", async () => {
    const result = await lookup("snickers");
    const product = foundProduct(result);
    expect(product).toMatchObject({
      name: "Snickers",
      quantity: "50 G",
      productQuantity: 50,
      productQuantityUnit: "g",
      servingQuantity: 50,
      servingQuantityUnit: "g",
      servingSize: "50 g",
      nutritionPer: "100g",
      noNutritionData: false,
      hasNutrients: true,
      hasNutrients100g: true,
      per100: { kcal: 481, protein: 8.6, carbs: 60.5, fat: 22.5, fibre: 4.3 },
      kcalFromKj: false,
    });
    expect(product.brand).toContain("Snickers");
  });

  it("reads a multipack with no serving and no brand", async () => {
    const result = await lookup("grenade-multipack");
    expect(result).toMatchObject({
      status: "found",
      product: {
        name: "Grenade carb killa",
        brand: null,
        quantity: "3 x 60 g",
        productQuantity: 180,
        servingQuantity: null,
        servingSize: null,
        per100: { kcal: 364, protein: 33.8, carbs: 28.2, fat: 14.8 },
      },
    });
    expect(foundProduct(result).per100.fibre).toBeUndefined();
  });

  it("tells Huel's prepared-only nutrition from nutrition per 100 g as sold", async () => {
    expect(foundProduct(await lookup("huel-prepared-only"))).toMatchObject({
      hasNutrients: true,
      hasNutrients100g: false,
      nutritionPer: "100g",
    });
  });

  it("reads a record with no nutriments as having no nutrients, and the no-nutrition flag", async () => {
    const result = lookupOpenFoodFacts("5000159461122", {
      fetch: answering(() =>
        json(
          productBody({
            product_name: "Bare",
            no_nutrition_data: "on",
            nutriments: { "nutrition-score-fr_100g": 12 },
          })
        )
      ),
    });
    expect(foundProduct(await result)).toMatchObject({
      hasNutrients: false,
      hasNutrients100g: false,
      noNutritionData: true,
    });
  });

  it("keeps zeros: Coca-Cola has 0 g protein and fat, and is in ml", async () => {
    const result = await lookup("coca-cola-can");
    expect(result).toMatchObject({
      status: "found",
      product: {
        productQuantity: 330,
        productQuantityUnit: "ml",
        servingQuantity: 330,
        servingQuantityUnit: "ml",
        per100: { kcal: 42.4, protein: 0, carbs: 10.6, fat: 0 },
      },
    });
  });

  it("ignores _prepared nutriments, so a prepared-only product has no nutrition", async () => {
    const result = await lookup("huel-prepared-only");
    expect(foundProduct(result)).toMatchObject({
      per100: {},
      kcalFromKj: false,
      servingQuantity: 51,
    });
    expect(foundProduct(result).per100).toEqual({});
  });

  it("ignores _serving nutriments", async () => {
    const result = await lookupOpenFoodFacts("5000159461122", {
      fetch: answering(() =>
        json(
          productBody({
            product_name: "Bar",
            nutriments: {
              "energy-kcal_serving": 240,
              proteins_serving: 4,
              proteins: 9,
            },
          })
        )
      ),
    });
    expect(result).toMatchObject({ status: "found", product: { per100: {} } });
  });

  it("converts kJ to whole kcal when kcal is absent, and says so", async () => {
    const result = await lookupOpenFoodFacts("5000159461122", {
      fetch: answering(() =>
        json(
          productBody({
            product_name: "Bar",
            nutriments: { "energy-kj_100g": 2018, proteins_100g: 8.6 },
          })
        )
      ),
    });
    // 2018 / 4.184 = 482.3
    expect(result).toMatchObject({
      status: "found",
      product: { per100: { kcal: 482, protein: 8.6 }, kcalFromKj: true },
    });
  });

  it("prefers kcal over kJ when both are there, even if they disagree", async () => {
    const result = await lookup("kind-kj-mismatch", "0602652279492");
    expect(result).toMatchObject({
      status: "found",
      product: {
        per100: { kcal: 450, protein: 15, carbs: 40, fat: 40, fibre: 20 },
        kcalFromKj: false,
        servingQuantity: 20,
        productQuantity: null,
      },
    });
  });

  it("coerces numeric strings and drops negative or unparseable values", async () => {
    const result = await lookupOpenFoodFacts("5000159461122", {
      fetch: answering(() =>
        json(
          productBody({
            product_name: "Bar",
            product_quantity: "abc",
            nutriments: {
              "energy-kcal_100g": "481",
              proteins_100g: "8.6",
              carbohydrates_100g: -3,
              fat_100g: "lots",
              fiber_100g: null,
            },
          })
        )
      ),
    });
    const product = foundProduct(result);
    expect(product.per100).toEqual({ kcal: 481, protein: 8.6 });
    expect(product.productQuantity).toBeNull();
    expect(product.name).toBe("Bar");
  });

  it("ignores keys it doesn't know", async () => {
    const body = offFixtureJson("walkers-no-serving");
    const result = await lookupOpenFoodFacts("5000328142081", {
      fetch: answering(() => json({ ...body, surprise: { nested: true } })),
    });
    expect(result).toMatchObject({
      status: "found",
      product: { name: "Walkers ready salted", brand: "Walkers" },
    });
  });

  it("says not-found for an HTTP 404", async () => {
    await expect(
      lookupOpenFoodFacts("00000000", {
        fetch: answering(() => fixture("not-found", 404)),
      })
    ).resolves.toEqual({ status: "not-found" });
  });

  it("says not-found for a v3 failure with product_not_found", async () => {
    await expect(lookup("not-found", "00000000")).resolves.toEqual({
      status: "not-found",
    });
  });

  it("says not-found, and warns, for a body it can't parse", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const body of [
      "<html>Bad gateway</html>",
      "null",
      JSON.stringify({ status: "success", product: "nope" }),
    ]) {
      await expect(
        lookupOpenFoodFacts("5000159461122", {
          fetch: answering(() => json(body)),
        })
      ).resolves.toEqual({ status: "not-found" });
    }
    expect(warn).toHaveBeenCalled();
  });

  it.each([429, 500, 502, 503])(
    "throws a RetryableError for HTTP %i",
    async (status) => {
      const err = await lookupOpenFoodFacts("5000159461122", {
        fetch: answering(() => json({ status: "failure" }, status)),
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RetryableError);
      expect((err as Error).message).toBe(
        "Open Food Facts isn't answering. Try again in a minute."
      );
    }
  );

  it("throws a RetryableError when the network fails", async () => {
    await expect(
      lookupOpenFoodFacts("5000159461122", {
        fetch: vi.fn<Fetch>().mockRejectedValue(new TypeError("fetch failed")),
      })
    ).rejects.toBeInstanceOf(RetryableError);
  });

  it("throws a RetryableError when the request times out", async () => {
    await expect(
      lookupOpenFoodFacts("5000159461122", {
        fetch: vi
          .fn<Fetch>()
          .mockRejectedValue(
            new DOMException("The operation timed out.", "TimeoutError")
          ),
      })
    ).rejects.toBeInstanceOf(RetryableError);
  });

  it("throws a plain UserFacingError, not a retryable one, for other statuses", async () => {
    const err = await lookupOpenFoodFacts("5000159461122", {
      fetch: answering(() => json({ status: "failure" }, 403)),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserFacingError);
    expect(err).not.toBeInstanceOf(RetryableError);
  });
});

describe("lookupOpenFoodFacts (strict, for writes)", () => {
  const strict = (response: () => Response) =>
    lookupOpenFoodFacts("5000159461122", {
      fetch: answering(response),
      strict: true,
    });

  it("still reads a found product and a real 'not found'", async () => {
    expect((await strict(() => fixture("snickers"))).status).toBe("found");
    expect((await strict(() => fixture("not-found"))).status).toBe("not-found");
  });

  it("takes a 404 as absent only with a product_not_found body", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await strict(() => fixture("not-found", 404))).status).toBe(
      "not-found"
    );
    for (const body of [
      "{}",
      "<html>Not Found</html>",
      { status: "failure" },
    ]) {
      await expect(strict(() => json(body, 404))).rejects.toBeInstanceOf(
        RetryableError
      );
    }
    // The lenient read keeps treating any 404 as absent.
    await expect(
      lookupOpenFoodFacts("5000159461122", {
        fetch: answering(() => json("{}", 404)),
      })
    ).resolves.toEqual({ status: "not-found" });
  });

  it("accepts v3's success_with_warnings when the product is there", async () => {
    const body = {
      ...offFixtureJson("snickers"),
      status: "success_with_warnings",
    };
    expect((await strict(() => json(body))).status).toBe("found");
    const bare = { status: "success_with_warnings" };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(strict(() => json(bare))).rejects.toBeInstanceOf(
      RetryableError
    );
  });

  it("throws on a reply it can't read instead of calling the product absent", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const body of ["<html>oops</html>", { status: "weird" }, {}]) {
      await expect(strict(() => json(body))).rejects.toBeInstanceOf(
        RetryableError
      );
    }
  });

  it("the lenient read still calls an unreadable reply not found", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      lookupOpenFoodFacts("5000159461122", {
        fetch: answering(() => json("<html>")),
      })
    ).resolves.toEqual({ status: "not-found" });
  });
});
