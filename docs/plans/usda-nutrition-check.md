# Checking recipe nutrition against USDA FoodData Central

Design for [#121](https://github.com/pendolohq/scrappy-meals/issues/121): recalculate each
recipe's calories and macros ingredient by ingredient from USDA FoodData Central (FDC),
compare them with what Mealie stores, and let us choose which values to keep. The issue's
decisions table is the brief; this page pins down what it leaves open.

## FoodData Central, as checked on 23 Oct 2026

Fixtures in `app/src/server/usda/fixtures/` are trimmed real responses (`DEMO_KEY`).

- **Key:** `X-Api-Key` header (api.data.gov), never the `api_key` query parameter, so it
  stays out of URLs and logs. About 1,000 requests an hour per key.
- **Search:** `POST https://api.nal.usda.gov/fdc/v1/foods/search`
  `{ query, dataType: ["Foundation", "SR Legacy", "Survey (FNDDS)"], pageSize }`. Each hit has
  `fdcId`, `description`, `dataType`, `foodCategory`, and `foodNutrients[]` as
  `{ nutrientId, nutrientName, unitName: "G" | "KCAL" | …, value }` per 100 g. FNDDS is
  needed for drinks and prepared foods ("Coffee, Cappuccino", 2710472, isn't in the other
  two).
- **Details:** `POST /fdc/v1/foods` `{ fdcIds: [...≤20], format: "full" }` returns an array.
  Nutrients are `{ nutrient: { id, name, unitName: "g" | "kcal" }, amount }` per 100 g.
  `format: "abridged"` drops the portions, and the `nutrients` filter returns no nutrients
  at all for Foundation and SR Legacy, so neither is used.
- **Nutrients (per 100 g):** kcal `1008` "Energy" (kcal; `1062` is kJ), and when a
  Foundation food has none, `2047` (Atwater General) then `2048` (Atwater Specific); protein
  `1003`; fat `1004`; carbohydrate `1005` "by difference" (includes fibre, like the app
  counts carbs), else `1050` "by summation"; fibre `1079`.
- **Portions** (`foodPortions[]`, `gramWeight` is for the whole portion):
  - SR Legacy: `amount` + `modifier` text ("1 clove", "3 cloves" = 9 g, "1 fruit (2" dia)",
    "1 cup, sliced"), `measureUnit.name` "undetermined".
  - Foundation: often only a `RACC` serving (kiwi 327046: "140 g"); sometimes a real one
    (egg 748967: `measureUnit.name` "egg", modifier "whole without shell", 50.3 g).
  - FNDDS: `portionDescription` ("1 fruit", "1 cup (8 fl oz)", "1 small"), `amount` null;
    "Quantity not specified" is a default, not a measure. Sizes are American (a small
    cappuccino is 360 g).
  - RACC and "NLEA serving" are reference servings, not measures: dropped.

## Data

Three tables in `planner` (`app/src/server/db/schema.ts`, one migration):

| Table | Holds |
| --- | --- |
| `usda_foods` | Cache, one row per `fdc_id` (integer PK): `description`, `data_type`, `per_100g` jsonb `Partial<Macros>`, `portions` jsonb `UsdaPortion[]`, `fetched_at`. Never expires: FDC publishes twice a year, and a match can be re-confirmed to refetch. |
| `usda_food_matches` | One row per Mealie food (`mealie_food_id` uuid PK): `food_name` (Mealie's name when saved, for display), `fdc_id` → `usda_foods`, `status` `suggested` \| `confirmed`, optional `piece_grams` numeric + `piece_label` (what one of it weighs when a line has no unit, picked from the USDA portions or typed), `updated_by` → users (set null), timestamps. |
| `usda_recipe_reviews` | One row per Mealie recipe id (uuid PK): `usda_per_serving` jsonb (the USDA figures the decision was made against), `choice` `mealie` \| `usda` \| `edited`, `decided_by` → users (set null), `decided_at`. |

The food match is household-wide, like plan edits: anyone signed in may confirm one.

## Converting a line to grams (`app/src/server/domain/usda-check.ts`, pure)

For each recipe ingredient (the cached `Ingredient`), in order:

1. A heading or blank line (no food, empty text): skipped.
2. No food but some text (unparsed): **needs an amount**, "not parsed".
3. No quantity ("olive oil, to taste"): a confirmed food that is negligible (≤ 5 kcal and
   every macro ≤ 0.5 g per 100 g: salt, water) counts as 0 g silently; a confirmed food with
   a default amount (`default_grams`, set on the Foods page, e.g. olive oil 10 g) counts that
   and the recipe lists it as **assumed**; anything else, matched or not, is **not counted**
   and listed. None of these stop the recipe from being checked.
4. A food with no confirmed match: listed under the recipe's **unmatched foods**.
5. A weight unit (`measure()` in `domain/units.ts` gives g): those grams.
6. A volume unit (`measure()` gives ml): × the food's `gramsPerMl` (Mealie extra), else ×
   grams-per-ml from the first USDA portion that is a volume (cup, tablespoon, teaspoon,
   fl oz, ml, litre, with US sizes as in `units.ts`); else **needs an amount**, "no weight for
   this volume".
7. Any other unit (clove, bunch, pinch, can…): the match's own weight for that unit
   (`unit_grams`, entered on the Foods page, keyed like the portion names below); else a
   USDA portion whose measure is that unit (name,
   abbreviation or plural; trimmed, lowercase, trailing "s" dropped; plus a small Italian
   alias list: spicchio → clove, fetta → slice, foglia → leaf, rametto → sprig, mazzo →
   bunch, pizzico → pinch, pezzo → piece, scatola/lattina → can) gives grams per one;
   else **needs an amount**, "no weight for <unit>".
8. No unit: the match's `piece_grams`; else **needs an amount**, "no weight for one".

Nothing else is guessed. Each line's contribution is `grams / 100 × per_100g` per macro. A
macro the USDA food doesn't have makes that macro unknown for the recipe, so it isn't
compared (shown as "–").

## A recipe's result

- **Can't check yet:** no servings, any unmatched food, or any line that needs an amount. The
  result lists them.
- Otherwise USDA per serving = sum / servings (kcal to the unit, grams to one decimal).
- **Per macro:** outside when `|mealie − usda| > max(10 % of usda, floor)`, floor 20 kcal or
  3 g. A macro Mealie lacks but USDA has counts as outside.
- **Mismatch:** any macro outside. **Matches:** none outside.
- **Reviewed:** a mismatch with a `usda_recipe_reviews` row whose `usda_per_serving` equals
  today's USDA figures. When the ingredients or a match change, the figures change and the
  recipe is flagged again.
- Products (`product` set on the cached recipe, or the Product tag) are left out.

## Matching foods

- **Suggest (Claude, `ANTHROPIC_API_KEY`):** a button works through the next 15 foods with no
  match row, most-used first. One call asks for an English FDC search query per Mealie food
  (given its name and up to 3 ingredient lines that use it, so "pomodori pelati" becomes
  "tomatoes, canned, whole"; raw unless the line says cooked). The server runs each search
  (top 8 hits); a second call picks one `fdcId` per food from those hits or none. A pick not
  in that food's hits is dropped. Picked foods are fetched (batch) and cached, then saved as
  `suggested`. Structured output and the same client setup as `nutrition-estimate.ts`;
  model `claude-sonnet-5-5`; rate-limited per user (10 runs an hour). Food names come from
  imported pages, so the prompt says they're data only, and nothing in a reply is shown
  except the chosen USDA food.
- **Search by hand:** a search box per food (USDA's own search, 10 hits with kcal per 100 g
  and data type), then pick. Works without `ANTHROPIC_API_KEY`.
- **Confirm:** saves `confirmed` with the `fdcId`, fetching and caching it first, and the
  optional piece weight. Confirming updates every recipe that uses the food, since results
  are computed on each page load.

## Pages (`/recipes/nutrition-check`)

All `notFound()` unless `USDA_FDC_API_KEY` is set; each calls `requireUser()`; actions are
`userAction`s. Data is read in Server Components; nothing calls FDC on a page load (only
the cache).

- **`/recipes/nutrition-check`:** counts and lists per group (Mismatch, Can't check yet,
  Reviewed, Matches), each recipe with its name, the macros outside, or what's missing. A
  link to the foods page with the number of foods to match. Recipes come from Mealie's full
  list (`GET /api/recipes?perPage=-1`, products dropped by tag) and `loadRecipes` in chunks
  of 20, `defer`ring stale refreshes.
- **`/recipes/nutrition-check/foods`:** foods used by those recipes, most-used first, in
  three groups: to match (with "Suggest matches"), suggested (Confirm / search another),
  confirmed (change). Each shows the USDA food and its portions; the piece weight is picked
  there.
- **`/recipes/nutrition-check/[slug]`:** the per-line breakdown (line, grams, USDA food, the
  macros it adds, or why it can't count) and Mealie vs USDA per serving, with the macros
  outside marked. For a mismatch: keep Mealie's values, use USDA's, or edit them (a form
  prefilled with USDA's). Saving writes the five macros to Mealie in one `PATCH` (other
  nutrition fields kept, `extras` through `withImportState` with `nutrition: "reviewed"`),
  refreshes the cache and upserts the review row. Keeping Mealie's values writes nothing
  to the macros but still marks the recipe `reviewed`.
- A "Check against USDA" link on `/recipes` when enabled.

## Modules

| Module | Role |
| --- | --- |
| `server/domain/usda.ts` | Pure: parse FDC search hits and details into `UsdaFood { fdcId, description, dataType, per100g, portions }`, `UsdaPortion { label, measure, grams }` (grams for one of `measure`). |
| `server/domain/usda-check.ts` | Pure: line grams, recipe result, thresholds, groups. |
| `server/usda/client.ts` | server-only: `usdaEnabled()`, `searchFoods`, `getFoods` (batches of 20), 15 s timeout, 429/5xx/network → `RetryableError`, 4xx → logged `Error`. Key read only here. |
| `server/usda/foods.ts` | server-only: cache and matches in Postgres. |
| `server/usda/suggest.ts` | server-only: Claude suggestions. |
| `server/usda/check.ts` | server-only: loads recipes, matches and cache into results; saves a decision. |

## Later (from the issue and its comments)

- Run the check on the import review page; a per-recipe button.
- Portions from a second FDC food (SR Legacy's "1 fruit = 69 g" beside Foundation kiwi
  nutrients). For now, pick the SR Legacy or FNDDS food, or type the piece weight.
- CREA Italian tables as a second source.
