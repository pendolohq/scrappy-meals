# Mealie API notes (v3.29.0)

What the planner relies on, checked against a running instance
(`/docs`, `/openapi.json`) and covered by `app/src/server/mealie/mealie.int.test.ts`.

## Client

- Types: `app/src/server/mealie/schema.d.ts`, generated from the committed
  `openapi.json` snapshot by `bun run mealie:types` (`MEALIE_URL=... bun run mealie:types`).
  Fields that have a server default are optional in the types.
- Wrapper: `client.ts` (auth, 10 s timeout, `MealieError`,
  `MealieUnavailableError`; `mealieImporter()` waits 60 s), `recipes.ts`,
  `import.ts`, `nutrition.ts`. Everything that holds the token
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
| Discover (filter) | `GET /api/recipes?tags=&categories=&requireAllTags=true&queryFilter=totalTimeSeconds…` (see below) |
| Tags / categories | `GET /api/organizers/tags\|categories?perPage=-1` (`recipeCount` per organizer) |
| Recipe detail | `GET /api/recipes/{slug}` (404 if unknown; also takes the recipe's id, which survives a rename); `recipeInstructions`, `notes` for the recipe page |
| Recipe image | `GET /api/media/recipes/{id}/images/min-original.webp` (proxied by the app at `/api/recipe-images/{id}`, signed-in users only) |
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

## Tags, categories and total time

The Discover page (`/recipes`) filters on Mealie's own tags and categories,
so they stay editable in Mealie. The add-meal picker uses the same filters
(`discoverRecipes`, through `/api/recipes/search`) with a name search on
top, starting on the slot's meal tag; Mealie ranks by relevance while
searching and by name otherwise. The agreed set is `RECIPE_TAGS` /
`RECIPE_CATEGORIES` in `src/server/domain/taxonomy.ts`; imports and the review
page only ever assign those.

- **Writing by name.** `PATCH` takes `tags` / `recipeCategory` as
  `[{ name }]`: Mealie finds the organizer by name (trimmed,
  case-insensitive) or creates it, and slugifies the name ("Meal prep" →
  `meal-prep`). An entry with an `id` of this group keeps that very
  organizer. The planner sends agreed ones by name and keeps others by id.
- **Filtering by slug.** `tags` and `categories` on `GET /api/recipes` take
  ids or slugs. `requireAllTags=true` makes tags AND; categories stay OR
  (`requireAllCategories=false`), since a recipe mostly has one. Picking
  *vegetarian* also asks for *vegan*. **A filter whose slugs Mealie doesn't
  know is dropped, not empty**, so the page only passes slugs from
  `/api/organizers/…`.
- **Total time is `totalTimeSeconds`** (integer). The text `totalTime` is
  no longer filled on import (an ISO `PT25M` ends up as 1500 seconds and a
  null text), and `PATCH`ing the text doesn't update the seconds. So the
  planner reads and writes seconds only, shown as whole minutes.
- **"Quick"** is `queryFilter=totalTimeSeconds > 0 AND totalTimeSeconds <= 1800`,
  in Mealie. Recipes without a time aren't quick.
- **Imports** are tagged in our code, not with Mealie's `includeTags` /
  `includeCategories` (those copy whatever keywords the page uses):
  keyword rules over the name and ingredient lines plus protein per serving
  (`classifyRecipe`), applied while marking the import pending, and only to
  a recipe with no tags or categories yet. The review page shows them as
  toggles, keeps any outside the agreed list, and asks for a total time when
  the source gave none.
- **Older recipes** need tags, categories and missing total times added by
  hand (in Mealie). Create the agreed tags and categories first, with the
  names above, so nothing near-duplicate gets made.

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
signed in, so cooking needs no Mealie account. `/recipes/<slug>` shows any
recipe the same way (the components are in `src/components/recipe/`), with
"cooking for" starting at the recipe's servings and an "Add to meal plan"
dialog that calls the week's `addMealAction`. Its slot starts where the tags
make it obvious (exactly one of breakfast, lunch, dinner, snack).

- **Tags, categories and total time** are shown under the title and cached
  with the rest; rows cached before they were kept are refetched on the
  recipe page's first visit.
- **Fields:** besides servings, nutrition and ingredients it shows
  `recipeInstructions` (`title` is an optional section heading above the step,
  `text` the step; `summary` is not used) and `notes` (`title`, `text`).
  `title` on an ingredient is a heading too. Empty steps and notes are
  dropped.
- **Ingredients under each step:** a step's `ingredientReferences[].referenceId`
  points at a `recipeIngredient[].referenceId` (Mealie's editor: a step's menu
  → Link Ingredients). The page lists the linked ingredients under the step,
  scaled with the Ingredients card; links to a line that's gone, or to a
  heading, show nothing. The planner never writes links. Rows cached before
  links were kept have no references and pick them up on the next refresh.
- **Cached** in `recipe_cache` with the rest of the recipe, so the page opens
  while Mealie is down. Rows cached before instructions were kept have
  `instructions` null and are fetched on the page's first visit.
- **Scaling:** ingredients are scaled to "cooking for" in the browser
  (`src/server/domain/ingredients.ts`), in the recipe's own units and to two
  decimals. Converting to grams and rounding up are for the shopping list
  only: a cook measures "2 tbsp", a shopper buys grams. "Cooking for" is never
  saved; portions are.
- **"Edit in Mealie"** links to `MEALIE_PUBLIC_URL` + `/g/<group slug>/r/<slug>`
  (`src/server/mealie/links.ts`). The link streams in after the page, so a
  Mealie that is down only leaves it out.
- **"Write a recipe in Mealie"**, under the import form on `/recipes/new`,
  links the same way to `/g/<group slug>/r/create/new`, Mealie's "Create
  recipe" page, for recipes with no page to import. The planner has no
  editor of its own for steps and ingredients.

## Servings and ingredients

- `recipeServings` is a number (0 = not set). `recipeYield` is free text
  ("1 loaf") and is not used as a servings count. A recipe with no servings is
  flagged, because shopping-list scaling needs it.
- Ingredients (`recipeIngredient[]`): parsed lines have `food` and `unit`
  objects with ids plus a numeric `quantity`; unparsed lines have only
  `note` / `originalText` / `display`, `food: null`, and `quantity` 0.
  The wrapper turns quantity 0 into `null` ("no amount").
- `title` on an ingredient is a section heading shown above it.

## Building the week's list

`buildShoppingList` (`src/server/domain/shopping.ts`) makes one line per
Mealie food, whatever units the recipes use:

- **Units convert through Mealie's own data.** Each unit has
  `standardQuantity` of a `standardUnit` (`tablespoon` is 0.5 `fluid_ounce`,
  `kilogram` is 1 `kilogram`); Mealie fills these in for the units it knows,
  including ones created by name ("gram", abbreviation "g"). Weights add up in
  grams, volumes in millilitres. Units without a standard (bunch, clove,
  pinch, can) add up per unit.
- **Density, per food:** a food's `scrappyGramsPerMl` extra (a string such
  as `"0.53"`, set with `PUT /api/foods/{id}` since Mealie's editor doesn't
  show extras) turns its volumes into grams. Without it, volumes stay in ml; nothing is guessed.
- **Rounding happens once, on the totals:** grams and ml up to whole ones
  until 100, then up to the next 10; everything else up to a whole one
  (three half onions are 2 onions).
- **Amounts that don't add up** stay on one line: `parsley 100 g + 1 bunch`.
- **Aisles** come from the food's Mealie label, mapped onto a short ordered
  list (`src/server/domain/aisles.ts`): Mealie's seeded labels ("Fresh
  Produce", "Health Foods", …) and labels named like an aisle. Unlabelled foods
  and other labels go under "Other", so a new food needs a label in Mealie to
  find its aisle. The checklist groups by it.
- Near-duplicate foods ("onion", "onions") are separate lines: combine them
  on Mealie's Foods page (or add an alias) rather than matching names in code.
- Rows in `recipe_cache` from before labels and unit standards were kept
  have neither, so they don't convert and sit under "Other" until the
  recipe is fetched again (at most an hour).

## Shopping from the planner

Mealie holds the recipes; the shopping list lives in the
planner's Postgres, so `/week/<monday>/shopping` is a checklist straight
away and works with Mealie down (the lines come from `recipe_cache`, like the
rest of the plan). The old `/shop` URL redirects there.

- **Tables:** `shopping_ticks` (week, line key, the amounts shown when ticked,
  who), `shopping_hidden` (plan lines removed for a week, permanently) and
  `shopping_extras` (hand-added lines; the uuid is made in the browser, so a
  replayed add is a no-op). Ticks are shared by the household, keyed by week.
- **Line keys:** the food id for a food line, `recipeId|text` for an unparsed
  line (the same line from two recipes is two lines).
- **The plan changes after a tick:** a tick stores the amounts it saw. If the
  line's current amounts exceed them in any unit, the line shows as unticked
  with "300 g more" (and the full total as detail); units that shrank or
  went don't count. Ticking again overwrites the snapshot. A line without
  amounts, or an unparsed one, stays ticked. A ticked line that leaves the
  plan keeps its row but isn't shown.
- **Checks:** a plan line's key from the browser isn't checked against the
  plan (the row is only shown for a line on that week's plan); an extra must
  belong to the week it's changed on.
- **Offline and retries:** ticks, adds and removals are queued in the browser
  (`localStorage`, per week), appended in order and sent one at a time
  (`flushQueue` in `lib/shop-list.ts`). A database that is down or being
  signed out keeps the queue and retries every 10 s and when the device is
  back online; anything else drops that one change and shows why until
  dismissed. Replays are harmless: ticks set a value, an add carries its id,
  and removing a gone item succeeds. Signing out clears the queue.
