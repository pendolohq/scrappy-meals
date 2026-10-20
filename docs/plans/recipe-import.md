# Recipe import

Add recipes to Mealie from the planner: from a recipe web page, and from an Instagram or
Facebook post or reel. Mealie does the scraping and the AI work; the planner adds the parts
Mealie doesn't have: a review step, and labels showing where nutrition came from.

## Decisions

- **Mealie does the import.** `POST /api/recipes/create/url` for web pages,
  `POST /api/recipes/create/ai` (text, images, URL; Mealie ≥ 3.23) for social posts. AI
  providers and models are configured in Mealie (group settings, per feature: default, image,
  audio), so the cost is set there. The app gets no AI key of its own.
- **The source URL is kept** in Mealie's `orgURL` for every import, set explicitly after an AI
  import, and shown in the planner as "Original post" / "Source".
- **Ingredients are parsed on import** with Mealie's parser
  (`POST /api/parser/ingredients`, `nlp`) and **reviewed before the recipe counts as done**.
- **AI-estimated nutrition is allowed, labelled "estimated"** everywhere macros show, until
  someone reviews it. Nutrition that came from the source page stays unlabelled. Missing stays
  missing; the planner itself still never estimates.
- **Import state lives on the recipe in Mealie**, in `extras` (string key/values), so it
  survives with Mealie's backups and needs no planner table:
  - `scrappyReview`: `pending` | `done` (absent = a recipe not imported through the planner,
    treated as done)
  - `scrappyNutrition`: `source` | `estimated` | `reviewed`
  Writes use `PATCH /api/recipes/{slug}` so other fields are left alone.
- **Two PRs:** milestone 1 (web page import + review), milestone 2 (social/AI import).

## Milestone 1: import from a web page

- [x] **1. Mealie client: import, parse, patch.** **Complexity:** M
  In `server/mealie/recipes.ts` (or a new `import.ts` there): `importRecipeFromUrl(url)`
  → slug via `create/url` (no tags/categories); a scrape failure becomes a `UserFacingError`
  ("Couldn't find a recipe on that page"), Mealie down stays a `RetryableError`.
  `parseIngredients(lines)` via `/api/parser/ingredients` (`nlp`), returning food/unit/quantity
  and the parser's confidence. `patchRecipe(slug, fields)` via PATCH. `findRecipeBySourceUrl`
  (`queryFilter` on `orgURL`) for duplicate detection. `Recipe` gains `sourceUrl` and
  `importState` (`{ review, nutrition }` read from `extras`, pure helper with unit tests).
  Integration tests in `mealie.int.test.ts` (import a known page served from a local fixture,
  parse, patch keeps untouched fields). Update the endpoint table in `docs/mealie-api.md`.

- [x] **2. Cache the import state.** **Complexity:** M (migration: full round)
  Depends on 1. Add `source_url`, `review_state`, `nutrition_source` to `recipe_cache` (Drizzle
  migration), filled by `loadRecipes`. `*.db.test.ts` coverage.

- [x] **3. "Add recipe" page.** **Complexity:** L (security: full round)
  Depends on 1. `/recipes/new`, linked from the header nav. One URL field;
  `userFormAction` with zod: `http(s)` only, no credentials in the URL, no single-label hosts or IPv4 literals.
  Mealie itself refuses loopback and private addresses (`safehttp`), so this is a second
  layer, not the only one.
  Rate-limited per user (20 an hour, `createRateLimiter`). If a recipe with the same
  `orgURL` exists, link to it instead of importing again. On success: `PATCH` only `extras`
  (`scrappyReview: pending`, `scrappyNutrition: source` when the page had any nutrition), then
  redirect to the review page. Ingredients are parsed by the review page, not here: the parser
  names foods and units Mealie may not have yet, which only the review's save creates. Follow
  `docs/security.md`; `access.test.ts` must pass unchanged.

  Interfaces:
  - `src/server/domain/recipe-url.ts` (pure): `normaliseRecipeUrl(input: string)` →
    `{ ok: true, url: string } | { ok: false, error: string }`. Trims; at most 2048 chars;
    `http:`/`https:` only; no username/password; hostname must contain a dot; drops the
    `#fragment`; returns `new URL(...).href`.
  - `src/server/recipe-import.ts` (server-only): `importRecipe(url, userId, deps?)` →
    `{ status: "imported", slug } | { status: "exists", slug, name }`. `deps` (all optional,
    for tests): `find`, `importFromUrl`, `getRecipe`, `patch`, `limiter`. Throws
    `UserFacingError` for: over the rate limit ("Too many imports. Try again in a while."), no
    recipe found ("Couldn't find a recipe on that page."), Mealie unreachable / timeout / 5xx
    ("Mealie didn't answer. If the page was slow, the recipe may still appear: try again in a
    minute."). Rate limit is counted before calling Mealie, keyed by `userId`.
  - `src/app/(app)/recipes/new/page.tsx` + `actions.ts` (`importRecipeAction`, a
    `userFormAction` with field `url`; invalid URL → the `normaliseRecipeUrl` error; success →
    `redirect("/recipes/<slug>/review")`; exists → `{ exists: { slug, name } }`, shown as
    "Already imported: <name>" linking to `/recipes/<slug>/review`). Header nav gets
    "Add recipe".

- [x] **4. Review page.** **Complexity:** L
  Depends on 2, 3. `/recipes/[slug]/review`: name, servings (required, shopping scaling needs
  it), source link, nutrition per serving (editable, with its source label), and each
  ingredient as original text beside the parsed amount/unit/food, low-confidence lines
  highlighted (lines already parsed in Mealie are shown as they are; only unparsed lines go
  through `parseIngredients` when the page loads). Per line: keep parsed, edit, or keep as a
  plain note. Foods and units the
  parser found that don't exist in Mealie are created on save (`POST /api/foods`,
  `/api/units`). Save = one `PATCH` (ingredients, servings, nutrition, `extras` →
  `scrappyReview: done`, `scrappyNutrition: reviewed` if edited/confirmed), then refresh the
  cache entry (`loadRecipes(..., { force: true })`). "Open in Mealie" for anything else.
  The page also works for a recipe with no `scrappyReview` key: an import that timed out after
  Mealie created the recipe leaves it unmarked, and "Already imported" links here, so the page
  must let it be reviewed rather than assume it's done. Any recipe can be opened here; the
  page doubles as the planner's recipe detail view.

  Interfaces:
  - `src/server/mealie/import.ts` gains `findOrCreateFood(name)` and `findOrCreateUnit(name)`
    → `{ id, name }`. Match an existing one case-insensitively and trimmed (foods: `name` or
    `pluralName`; units: `name`, `pluralName` or `abbreviation`) via `GET /api/foods|units`
    with `search`, else `POST`. Integration-tested.
  - `src/server/recipe-review.ts` (server-only):
    - `loadReview(slug, deps?)` → `ReviewDraft | null` (null for an unknown slug):
      `{ slug, name, servings: number | null, sourceUrl, mealieUrl (MEALIE_PUBLIC_URL +
      /g/<group slug>/r/<slug>, group slug from `GET /api/groups/self`, cached per process;
      null without the variable), importState, nutrition: Record<MacroKey,
      number | null>, lines: ReviewLine[] }`. `ReviewLine`: `{ key: string (referenceId, else
      the index), original: string (originalText || note || display), title: string | null,
      quantity: number | null, unit: string | null, food: string | null, note: string,
      confidence: number | null (null for lines Mealie already had parsed), asText: boolean
      (true when the parser found no food) }`. Unparsed lines are sent to `parseIngredients` in
      one call; already-parsed lines (with a food or unit id) are not.
    - `saveReview(slug, input, deps?)`: `input` = `{ servings: number > 0, nutrition:
      Record<MacroKey, number ≥ 0 | null>, lines: Array<{ referenceId?: string | null, title: string | null, asText:
      boolean, quantity: number | null, unit: string | null, food: string | null, note: string
      }> }` (in order; at most 200 lines). `referenceId` is the line's key from the page: the server finds Mealie's stored ingredient by it and carries over its `referenceId`, `originalText` (set to the displayed line when it had none), `referencedRecipe` and `substitutions`, and keeps its food/unit ids while the names are unchanged. Nutrition fields left as loaded keep Mealie's raw text. Lines with `asText` (or no food) become note-only
      ingredients (`quantity: 0`, `note` = the text); others resolve unit/food names with
      `findOrCreateUnit`/`findOrCreateFood` (each distinct name once). Then one `patchRecipe`:
      `recipeServings`, `nutrition` (numbers as strings; null → null; Mealie's other nutrition
      fields kept), `recipeIngredient`, `extras` via `withImportState` (`review: "done"`,
      `nutrition: "reviewed"` when any macro is set, else null). Then refresh the cache entry
      (`loadRecipes(db, [slug], { force: true })`). Mealie down → `RetryableError`, like the
      import.
  - `src/app/(app)/recipes/[slug]/review/page.tsx` (`requireUser`, `notFound()` for an unknown
    slug) + `actions.ts` (`saveReviewAction`, a `userAction` taking `{ slug, ...input }`; plan
    edits are household-wide, so any signed-in user may review) + a client form.
    UI text the tests rely on: the recipe name as the page heading; a "Source" link (when
    there is one) and "Open in Mealie"; inputs labelled "Servings", "Calories (kcal)",
    "Protein (g)", "Carbs (g)", "Fat (g)", "Fibre (g)"; the nutrition label "From the page",
    "Estimated", "Reviewed", "Edited" (a macro changed since loading) or "Missing"; each ingredient a `fieldset` whose legend is the
    original line, with inputs "Amount", "Unit", "Food", "Note" and a checkbox "Keep as text";
    lines with confidence below 0.8 show "Check this line"; a "Save recipe" button; after a
    successful save a status "Saved" and a link "Back to the plan". Errors in
    `p[role=alert]` inside `main`.

- [x] **5. Show import state in the planner.** **Complexity:** M
  Depends on 2. Wherever macros show (meal rows, day/person totals), an "estimated" label when
  any recipe in the sum has `nutrition_source = estimated`. A "needs review" badge on recipes
  with `review_state = pending`, linking to the review page. A "Source" link where a recipe is
  shown in detail.

- [x] **6. Docs and e2e.** **Complexity:** S
  Depends on 3–5. README features, `docs/mealie-api.md` (import, parser, extras keys), an e2e
  path: add a recipe from a fixture page, review it, plan it.

## Milestone 2: import from Instagram / Facebook

- [ ] **7. Spike against a real Mealie with an AI provider.** **Complexity:** S
  Needs the owner's AI key configured in Mealie (cheap text/image model, a transcription model
  for audio). Find out, and record in `docs/mealie-api.md`: does `create/ai` with a reel URL
  transcribe it from the server without signing in to Instagram/Facebook (else Mealie's
  `YTDLP_COOKIEFILE`), does it set `orgURL`, does it fill nutrition when the source has none,
  how long it takes (the app's Mealie timeout is 10 s), what it costs per import.

- [ ] **8. Social import on the "Add recipe" page.** **Complexity:** L (full round)
  Depends on 7 and milestone 1. Instagram/Facebook links (`instagram.com`, `facebook.com`,
  `fb.watch`) go through `create/ai` with the URL, plus optional pasted caption and
  screenshots (size/count limits, server action body limit). If the video can't be fetched,
  say so and ask for the caption or screenshots. Always set `orgURL` to the post URL. Nutrition
  from an AI import is `estimated`. Same review step as milestone 1.

- [ ] **9. Estimate missing nutrition.** **Complexity:** M
  Depends on 7. If the spike shows `create/ai` estimates nutrition, offer "Estimate with AI" on
  the review page for web-page imports that have none, marked `estimated`. If it doesn't,
  decide with the owner before building anything (the alternative is the app calling a model
  itself, which needs its own key and env var).

- [ ] **10. Deploy docs.** **Complexity:** S
  `docs/deploy.md`: set up AI providers in Mealie (which features need which provider, picking
  cheap models), and `YTDLP_COOKIEFILE` if the spike shows it's needed (then `.env.example`
  and `docker-compose.yml` too).
