import { describe, expect, it, vi } from "vitest";

import type { UsdaHit } from "../domain/usda";

import { suggestMatches } from "./suggest";

/*
 * Contract for `suggestMatches(foods, deps)`, the part of "Suggest matches"
 * that decides what may be saved. The Claude calls and the USDA search are
 * injected, so nothing here touches the SDK.
 *
 *   foods:            { id, name, lines }[]   Mealie foods with up to 3 ingredient lines each
 *   deps.queries(foods)      -> Record<foodId, string>      an English FDC query per food
 *   deps.search(query, 8)    -> UsdaHit[]                   USDA's top hits
 *   deps.picks(candidates)   -> Record<foodId, fdcId|null>  candidates: { foodId, name, hits }[]
 *
 * Returns { foodId, hit }[]: a pick is only kept when it is one of that
 * food's own hits.
 */

type Deps = Parameters<typeof suggestMatches>[1];

const hit = (fdcId: number, description = `Food ${fdcId}`): UsdaHit => ({
  fdcId,
  description,
  dataType: "SR Legacy",
  foodCategory: null,
  per100g: { kcal: 50 },
});

const tomatoes = {
  id: "f-tom",
  name: "pomodori pelati",
  lines: ["400 g pomodori pelati"],
};
const garlic = { id: "f-gar", name: "aglio", lines: ["2 spicchi aglio"] };

function makeDeps(
  hits: Record<string, UsdaHit[]>,
  picks: Record<string, number | null>
) {
  const queries = vi.fn<Deps["queries"]>().mockResolvedValue({
    "f-tom": "tomatoes, canned, whole",
    "f-gar": "garlic, raw",
  });
  const search = vi
    .fn<Deps["search"]>()
    .mockImplementation(async (query) => hits[query] ?? []);
  const pick = vi.fn<Deps["picks"]>().mockResolvedValue(picks);
  const deps: Deps = { queries, search, picks: pick };
  return { deps, queries, search, pick };
}

const HITS = {
  "tomatoes, canned, whole": [hit(11), hit(12)],
  "garlic, raw": [hit(21), hit(22)],
};

describe("suggestMatches", () => {
  it("searches USDA for each query, asking for the top 8", async () => {
    const { deps, queries, search } = makeDeps(HITS, {});

    await suggestMatches([tomatoes, garlic], deps);

    expect(queries).toHaveBeenCalledWith([tomatoes, garlic]);
    expect(search).toHaveBeenCalledWith("tomatoes, canned, whole", 8);
    expect(search).toHaveBeenCalledWith("garlic, raw", 8);
  });

  it("offers Claude each food's own hits to choose from", async () => {
    const { deps, pick } = makeDeps(HITS, {});

    await suggestMatches([tomatoes, garlic], deps);

    expect(pick).toHaveBeenCalledWith([
      expect.objectContaining({
        foodId: "f-tom",
        name: "pomodori pelati",
        hits: HITS["tomatoes, canned, whole"],
      }),
      expect.objectContaining({
        foodId: "f-gar",
        name: "aglio",
        hits: HITS["garlic, raw"],
      }),
    ]);
  });

  it("returns the hit Claude picked for each food", async () => {
    const { deps } = makeDeps(HITS, { "f-tom": 12, "f-gar": 21 });

    await expect(suggestMatches([tomatoes, garlic], deps)).resolves.toEqual([
      { foodId: "f-tom", hit: hit(12) },
      { foodId: "f-gar", hit: hit(21) },
    ]);
  });

  it("drops a pick that isn't among that food's hits", async () => {
    const { deps } = makeDeps(HITS, { "f-tom": 999, "f-gar": 21 });

    await expect(suggestMatches([tomatoes, garlic], deps)).resolves.toEqual([
      { foodId: "f-gar", hit: hit(21) },
    ]);
  });

  it("drops a pick that is a hit for another food", async () => {
    const { deps } = makeDeps(HITS, { "f-tom": 21 });

    await expect(suggestMatches([tomatoes, garlic], deps)).resolves.toEqual([]);
  });

  it("saves nothing for a null pick", async () => {
    const { deps } = makeDeps(HITS, { "f-tom": null, "f-gar": null });

    await expect(suggestMatches([tomatoes, garlic], deps)).resolves.toEqual([]);
  });

  it("ignores a pick for a food it wasn't asked about", async () => {
    const { deps } = makeDeps(HITS, { "f-other": 11 });

    await expect(suggestMatches([tomatoes], deps)).resolves.toEqual([]);
  });

  it("skips a food Claude gave no query for, or whose search found nothing", async () => {
    const { deps, queries, pick } = makeDeps(
      { "garlic, raw": [hit(21)] },
      { "f-gar": 21 }
    );
    queries.mockResolvedValue({
      "f-gar": "garlic, raw",
      "f-tom": "tomatoes, canned, whole",
    });

    const result = await suggestMatches([tomatoes, garlic], deps);

    expect(result).toEqual([{ foodId: "f-gar", hit: hit(21) }]);
    expect(pick.mock.calls[0]![0].map((c) => c.foodId)).toEqual(["f-gar"]);
  });

  it("doesn't ask Claude to pick when no search found anything", async () => {
    const { deps, pick } = makeDeps({}, {});

    await expect(suggestMatches([tomatoes], deps)).resolves.toEqual([]);
    expect(pick).not.toHaveBeenCalled();
  });

  it("cuts a long query to 100 characters before searching", async () => {
    const { deps, queries, search } = makeDeps({}, {});
    queries.mockResolvedValue({ "f-tom": "x".repeat(300) });

    await suggestMatches([tomatoes], deps);

    expect(search).toHaveBeenCalledWith("x".repeat(100), 8);
  });

  it("does nothing for no foods", async () => {
    const { deps, queries } = makeDeps(HITS, {});

    await expect(suggestMatches([], deps)).resolves.toEqual([]);
    expect(queries).not.toHaveBeenCalled();
  });
});
