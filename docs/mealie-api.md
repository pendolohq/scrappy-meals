# Mealie API notes (v3.29.0)

What the planner relies on, checked against a running instance
(`/docs`, `/openapi.json`) and covered by `app/src/server/mealie/mealie.int.test.ts`.

## Client

- Types: `app/src/server/mealie/schema.d.ts`, generated from the committed
  `openapi.json` snapshot by `pnpm mealie:types` (`MEALIE_URL=... pnpm mealie:types`).
  Fields that have a server default are optional in the types.
- Wrapper: `client.ts` (auth, 10 s timeout, `MealieError`), `recipes.ts`,
  `shopping.ts`, `nutrition.ts`. Everything that holds the token imports
  `server-only`, so it can't end up in a client bundle.
- Auth: `Authorization: Bearer <token>`. Create a long-lived token in Mealie
  under Profile → API Tokens (`POST /api/users/api-tokens`).
- `checkMealieVersion()` compares `/api/app/about` with the schema version; the
  health route will report a mismatch after a Mealie upgrade.

**Upgrading Mealie:** bump the tag in `docker-compose.yml`, run
`pnpm mealie:types` against it, update `MEALIE_SCHEMA_VERSION` in `client.ts`,
then run `pnpm typecheck` and `pnpm test:integration`.

## Endpoints used

| Purpose | Endpoint |
|---|---|
| Search / list recipes | `GET /api/recipes?search=&page=&perPage=` (paginated: `items`, `total`, `total_pages`) |
| Recipe detail | `GET /api/recipes/{slug}` (404 if unknown) |
| Recipe image | `GET /api/media/recipes/{id}/images/min-original.webp` (proxied by the app at `/api/recipe-images/{id}`, signed-in users only) |
| Find list by name | `GET /api/households/shopping/lists?queryFilter=name = "..."` |
| Create list | `POST /api/households/shopping/lists` |
| List items | `GET /api/households/shopping/lists/{id}` (`listItems`) |
| Add items | `POST /api/households/shopping/items/create-bulk` → `createdItems` / `updatedItems` |
| Remove items | `DELETE /api/households/shopping/items?ids=...&ids=...` |
| Version | `GET /api/app/about` |

## Nutrition

- Fields are strings: `calories`, `proteinContent`, `carbohydrateContent`,
  `fatContent`, `fiberContent` (plus sugar, sodium etc. we don't use).
- **Per serving.** Mealie imports schema.org `NutritionInformation`, which is
  per serving, and its own AI-import schema documents every field as "per
  serving". Units: kcal for calories, grams otherwise (mg for sodium and
  cholesterol). So the planner multiplies by servings eaten and never divides.
- The URL scraper strips values down to the number, but hand-entered values can
  be anything. `normaliseNutrition` accepts only a plain number with an
  optional expected unit (`12`, `12,5`, `7 g`, `250 kcal`). Blanks, ranges
  (`10-12`) and other units count as **missing**, and the recipe is flagged
  `partial` / `missing`; we never estimate.

## Servings and ingredients

- `recipeServings` is a number (0 = not set). `recipeYield` is free text
  ("1 loaf") and is not used as a servings count. A recipe with no servings is
  flagged, because shopping-list scaling needs it.
- Ingredients (`recipeIngredient[]`): parsed lines have `food` and `unit`
  objects with ids plus a numeric `quantity`; unparsed lines have only
  `note` / `originalText` / `display`, `food: null`, and `quantity` 0.
  The wrapper turns quantity 0 into `null` ("no amount").
- `title` on an ingredient is a section heading shown above it.

## Shopping lists

- `create-bulk` takes `foodId` / `unitId` directly; Mealie fills in `display`.
- **Mealie merges server-side:** an item with the same food and unit as an
  existing unchecked item on the list increases that item's quantity, and comes
  back in `updatedItems`, not `createdItems`. Free-text items (no food) are not
  merged. The planner pushes to its own list per week, so merging only ever
  combines its own lines.
- `recipeReferences: [{ recipeId }]` links an item to the recipes it came from;
  Mealie shows these on the item.
