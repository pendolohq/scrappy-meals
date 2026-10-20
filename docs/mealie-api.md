# Mealie API notes (v3.29.0)

What the planner relies on, checked against a running instance
(`/docs`, `/openapi.json`) and covered by `app/src/server/mealie/mealie.int.test.ts`.

## Client

- Types: `app/src/server/mealie/schema.d.ts`, generated from the committed
  `openapi.json` snapshot by `bun run mealie:types` (`MEALIE_URL=... bun run mealie:types`).
  Fields that have a server default are optional in the types.
- Wrapper: `client.ts` (auth, 10 s timeout, `MealieError`,
  `MealieUnavailableError`; `mealieImporter()` waits 60 s), `recipes.ts`,
  `import.ts`, `shopping.ts`, `nutrition.ts`. Everything that holds the token
  imports `server-only`, so it can't end up in a client bundle.
- Auth: `Authorization: Bearer <token>`. Create a long-lived token in Mealie
  under Profile → API Tokens (`POST /api/users/api-tokens`).
- `checkMealieVersion()` compares `/api/app/about` with the schema version; the
  health route will report a mismatch after a Mealie upgrade.

**Upgrading Mealie:** bump the tag in `docker-compose.yml` and the two in
`.github/workflows/ci.yml`, run `bun run mealie:types` against it, update
`MEALIE_SCHEMA_VERSION` in `client.ts` and this page's title, then run
`bun run test`, `bun run typecheck` and `bun run test:integration`. `bun run test` fails
until every place names the same version (`mealie-version.test.ts`).

## Endpoints used

| Purpose | Endpoint |
|---|---|
| Search / list recipes | `GET /api/recipes?search=&page=&perPage=` (paginated: `items`, `total`, `total_pages`) |
| Recipe detail | `GET /api/recipes/{slug}` (404 if unknown; also takes the recipe's id, which survives a rename); `recipeInstructions`, `notes` for the recipe page |
| Recipe image | `GET /api/media/recipes/{id}/images/min-original.webp` (proxied by the app at `/api/recipe-images/{id}`, signed-in users only) |
| Find list by name | `GET /api/households/shopping/lists?queryFilter=name = "..."` |
| Create list | `POST /api/households/shopping/lists` |
| List items | `GET /api/households/shopping/lists/{id}` (`listItems`) |
| Add items | `POST /api/households/shopping/items/create-bulk` → `createdItems` / `updatedItems` |
| Remove items | `DELETE /api/households/shopping/items?ids=...&ids=...` |
| Read one item | `GET /api/households/shopping/items/{id}` |
| Tick / untick | `PUT /api/households/shopping/items/{id}` (whole item, see below) |
| Import from a URL | `POST /api/recipes/create/url` → slug; 400 when it finds no recipe (see below) |
| Import with AI | `POST /api/recipes/create/ai` (multipart: `content`, `url`, `images[]`) → slug; see below |
| AI enabled? | `GET /api/groups/self` → `aiProviderSettings.aiEnabled`, `.imageProviderEnabled` (see below) |
| Find by source URL | `GET /api/recipes?queryFilter=orgURL = "..."` |
| Parse ingredients | `POST /api/parser/ingredients` (`parser: nlp`) |
| Change some fields | `PATCH /api/recipes/{slug}` (fields left out are kept) |
| Find or create a food / unit | `GET /api/foods\|units?search=&orderBy=name`, else `POST` |
| Group slug (for links) | `GET /api/groups/self` → `slug` |
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

## Importing recipes

- `create/url` fetches the page from Mealie's container and reads its
  schema.org `Recipe` data. It answers **400 with a generic message** for
  everything that goes wrong: no recipe on the page, page unreachable, or an
  address Mealie refuses. Mealie's HTTP client (`safehttp`) resolves the host
  and refuses loopback and private addresses, so it can't be pointed at the
  Compose network. The same scraper runs on given HTML with
  `create/html-or-json` (`data`, optional `url`), which the integration tests
  use because CI has no page Mealie may fetch.
- The page's URL is stored as `orgURL`. Nutrition is kept per serving with
  units stripped (`"320 kcal"` → `"320"`); `recipeYield` "4 servings" becomes
  `recipeServings: 4`.
- **Ingredients arrive unparsed** (`note` only, quantity 0). The NLP parser
  returns, per line, `quantity`, `unit` and `food` **by name, with `id: null`
  when Mealie has no such unit or food yet**, plus `confidence.average`
  (0–1). Low confidence is typical for lines like "a squeeze of lemon".
- **Import state** lives in the recipe's `extras` (string values):
  `scrappyReview` (`pending` | `done`; absent = done) and `scrappyNutrition`
  (`source` | `estimated` | `reviewed`). `PATCH` replaces `extras` as a
  whole, so write it with `withImportState()`, which keeps other keys.

## Importing with AI

The planner uses it for Instagram and Facebook posts: it reads the group's AI
flags first (from `groups/self`; no provider, or screenshots without an `image` provider, fail with a
clear message), then posts the caption as `content`, the screenshots as
`images` and the post address as `url`, with a 120 s timeout.

`create/ai` (Mealie ≥ 3.23) builds a recipe from any mix of pasted text
(`content`), a `url` and screenshots (`images`, multipart). Measured on
Mealie 3.29 with Claude Sonnet 5.5 as the provider:

- **Providers are per group** (`/api/groups/ai-providers/…`; in Mealie, Group
  Settings → AI Providers): create a provider (OpenAI-compatible base URL, key,
  model), then pick it as `default`, `image` and/or `audio`. Without `default`
  every call fails; with images it also needs `image`. A video URL is only
  downloaded and transcribed when `audio` is set, otherwise Mealie reads the
  URL as a web page.
- **Only group managers can read or change the provider settings**
  (`/api/groups/ai-providers/settings` answers 403 to a plain member, like the
  planner's token). `GET /api/groups/self` carries the same `aiEnabled` /
  `imageProviderEnabled` flags for any member, so the planner reads those.
  `create/ai` itself works with a member's token.
- **Claude works through Anthropic's OpenAI-compatible endpoint**
  (`https://api.anthropic.com/v1/`, model `claude-sonnet-5-5`). Mealie asks for
  JSON with `response_format`, which that endpoint ignores, but the replies
  parsed cleanly every time. Mealie sends no `temperature`/`top_p`, which
  current Claude models reject. Claude can't be the `audio` provider: Mealie
  transcribes with `audio.transcriptions`, which Anthropic doesn't offer.
- **It never estimates nutrition.** Mealie's prompt says to fill nutrition
  only when the source states it, and that's what happened: stated values
  come through per serving and unit-less (`"520"`), missing ones stay empty.
  So an AI import's nutrition is `source`, not `estimated`.
- **`orgURL` is set to the `url` passed in**, even when the page itself had
  nothing useful (an Instagram login wall, with the caption pasted as
  `content`). Without a `url` it stays empty.
- **A post link alone isn't enough.** For a public Facebook reel, Facebook
  serves the whole caption without signing in (in `og:description`, cut short,
  and in full in the page's embedded JSON), but Mealie answers 400 "No recipe
  was found": it reads the page as visible text, which leaves the caption out.
  The same link with the caption pasted as `content` imports completely. So
  for social posts the caption (or a screenshot) has to come with the link.
- **Same shape as a URL import:** ingredients arrive unparsed (`note` only),
  `recipeServings` is set when the source says so, and `extras` is empty, so
  the import state and review step work unchanged.
- **Slow:** 4–40 s for text, about 13 s for one screenshot. Mealie answers only
  when it's done; `create/ai/stream` sends progress as server-sent events
  instead.
- **Errors** come back as 400 with a message (e.g. AI not enabled); with a
  screenshot, the first image is meant to become the cover image, though
  `image` was still empty on the recipe that came back.

## Reviewing a recipe

`/recipes/<slug>/review` (`src/server/recipe-review.ts`) is where an import is
checked and a recipe's ingredients, servings and nutrition are edited.

- **Loading:** lines Mealie already has parsed (a food or unit id) are shown
  as they are. The rest go through the parser as suggestions, unless the
  recipe was already reviewed through the planner (`scrappyReview: done`):
  then unparsed lines are text someone chose to keep.
- **Saving is one `PATCH`.** It replaces `recipeIngredient` as a whole, so
  each line carries its `referenceId` and the server copies the fields the
  form doesn't edit from Mealie's current copy: `referenceId`,
  `originalText`, `referencedRecipe`, `substitutions`. Lines that link
  another recipe go back unchanged. `originalText` is filled in only for
  lines that had no parse, so their original wording survives the save.
- **Foods and units** the parser named but Mealie lacks are created, matched
  first by name, plural or abbreviation, trimmed and case-insensitive, over
  every page of search results (at most 4 lookups at a time). Two spellings
  that match nothing ("tomato", "tomatoes") still create two foods.
- **Nutrition:** only macros whose value changed are written; a value the
  planner can't read ("10-12") is kept as Mealie has it and shown beside the
  empty field. Other nutrition fields (sodium etc.) are kept.
- **Links to Mealie** use `MEALIE_PUBLIC_URL` + `/g/<group slug>/r/<slug>`.

## The recipe page

`/week/<monday>/meals/<meal id>` shows a planned meal's recipe to everyone
signed in, so cooking needs no Mealie account.

- **Fields:** besides servings, nutrition and ingredients it shows
  `recipeInstructions` (`title` is an optional section heading above the step,
  `text` the step; `summary` is not used) and `notes` (`title`, `text`).
  `title` on an ingredient is a heading too. Empty steps and notes are
  dropped.
- **Cached** in `recipe_cache` with the rest of the recipe, so the page opens
  while Mealie is down. Rows cached before instructions were kept have
  `instructions` null and are fetched on the page's first visit.
- **Scaling:** ingredients are scaled to "cooking for" in the browser with
  the same rounding and units as the shopping list
  (`src/server/domain/ingredients.ts`), so at the planned servings both show
  the same amounts. "Cooking for" is never saved; portions are.
- **"Edit in Mealie"** links to `MEALIE_PUBLIC_URL` + `/g/<group slug>/r/<slug>`
  (`src/server/mealie/links.ts`). The link streams in after the page, so a
  Mealie that is down only leaves it out.

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
  merged. The planner pushes to its own list per week, but a line someone added
  by hand with the same food and unit gets merged too. The planner only owns
  the items it created, so such a merged item keeps growing with every push;
  the push reports these merges and the page asks to check their quantities.
- `recipeReferences: [{ recipeId }]` links an item to the recipes it came from;
  Mealie shows these on the item.

## How the planner pushes a week

- One Mealie list per week, named `Scrappy Meals · week of <d Mon yyyy>`.
  Its id and the ids of the items the planner created are kept in
  `shopping_pushes`.
- Pushing again deletes those items (ticked or not) and adds the new set, so
  the list always matches the plan. Items added by hand in Mealie stay. If
  the list was deleted in Mealie, a new one is created.
- Parsed lines go in with `foodId`/`unitId` and a recipe reference; unparsed
  lines go in as notes ("a squeeze of lemon (×2) · Red Lentil Soup").
- Links to the list use `MEALIE_PUBLIC_URL` (`https://recipes.<domain>` in
  compose) + `/shopping-lists/<id>`.

## Shopping from the planner

`/week/<monday>/shopping` previews what the plan needs until the week is sent;
after that it is a checklist over the week's Mealie list (the preview folds
away under it), so nobody needs Mealie's own UI in the shop. Mealie stays the
only copy of the list. The old `/shop` URL redirects there.

- **Reading:** the page reads the list's items straight from Mealie on every
  load (and every 15 s while open), ticks and hand-added lines included.
  Items are grouped by their Mealie label (the item's, else its food's), as
  aisles; unlabelled items go under "Other".
- **Ticking:** `PUT /items/{id}` **replaces the whole item**: fields left out
  fall back to defaults (quantity 1, empty note, no recipe references). So a
  tick writes back the item it just read (to check ownership, below) with
  only `checked` changed (`setShoppingItemChecked`). Ticks set a value, never
  toggle, so a replayed tick is harmless. Unticking may merge the item into a
  matching unticked one; the page reloads the list after every change anyway.
- **Ownership:** item ids come from the browser, so every change first checks
  that the item is on the list recorded for that week in `shopping_pushes`;
  anything else is refused.
- **Adding:** a quick-added line is a note item (quantity 0). It isn't
  recorded as the planner's, so sending the week again keeps it.
- **Re-sending** the week still replaces the planner's own items, ticks
  included; hand-added lines stay.
- **Offline and retries:** ticks, adds and removals are queued in the browser
  (`localStorage`, per list), appended in order and sent one at a time
  (`flushQueue` in `lib/shop-list.ts`). Anything that can go away on its own
  (offline, Mealie or the database down, Mealie refusing the token, signed
  out) keeps the queue and retries every 10 s and when the device is back
  online; anything else drops that one change and shows why until dismissed.
  Replays are harmless: ticks set a value and removing a gone item succeeds.
  An add whose answer was lost can come back as a duplicate line. Signing out
  clears the queue. Two people changing the same item: the last save wins,
  for every field, since a tick writes the whole item back.
