# Packaged products (scan a barcode)

Investigation for [#57](https://github.com/pendolohq/scrappy-meals/issues/57): log a protein
bar, a yoghurt or a bag of nuts by scanning its barcode, including after it was eaten, so it
counts in that person's totals like any meal. Findings first, then the recommended design and
the PRs it splits into.

## Findings

### Product data: Open Food Facts

Checked live on 21 Oct 2026 against `world.openfoodfacts.org`.

- **API.** `GET /api/v3/product/<code>?fields=…` is the current version; v2 is "deprecated
  but still supported". Not found is `{"status":"failure","result":{"id":"product_not_found"}}`
  (v2: HTTP 404, `status: 0`). The fields we need: `product_name`, `brands`, `quantity`
  (free text, "3 x 60 g"), `product_quantity` (number), `serving_size` (free text),
  `serving_quantity` (number), `serving_quantity_unit`, `nutrition_data_per` (`100g` or
  `serving`), `image_front_small_url`, and under `nutriments`: `energy-kcal_100g`,
  `energy-kj_100g`, `proteins_100g`, `carbohydrates_100g`, `fat_100g`, `fiber_100g` (and the
  `_serving` twins). `energy_100g` is **kJ**, not kcal. Drinks say `nutrition_data_per: 100ml`
  but keep the `_100g` key names.
- **Limits.** 15 product reads a minute per IP (search: 10), over that a 503 or a ban. A
  `User-Agent` of the form `AppName/Version (contact)` is required. Staging is
  `world.openfoodfacts.net` (basic auth `off:off`).
- **Licence.** Database ODbL, contents DbCL, images CC BY-SA. Showing the data needs a credit
  to Open Food Facts with a link (ideally the product page). Keeping copies in our own Mealie
  for the household is fine; share-alike only bites if we published the derived database.
- **Coverage for what we buy.** 15 UK cupboard barcodes: 12 found, 3 not. Of the 12:

  | Product | Per serving on OFF | Notes |
  |---|---|---|
  | Coca-Cola 330 ml, Snickers 50 g, Nature Valley 42 g | yes, consistent | |
  | Kind bar | yes | kJ disagrees with kcal; fat per 100 g looks wrong |
  | Fage Total 0% 450 g | yes | the "serving" is 100 g, not the pot |
  | Müller Corner, Grenade Carb Killa, Graze, Walkers, Tesco cashews, Alpro | **no** | per 100 g only; Grenade's `quantity` is "3 x 60 g" |
  | Huel bar | **no nutrition at all** | |
  | Dairy Milk Wholenut 45 g | empty record | |

  So the name is almost always there, per-100 g values usually, **per-serving values only about
  half the time**, and the data is sometimes wrong (kJ/kcal mismatches; a Twirl with a 100 g
  "serving"). `_serving` values are derived by OFF from `_100g × serving_quantity`, so they are
  only as good as `serving_quantity`.
- **Browser or server.** OFF sends `Access-Control-Allow-Origin: *` and our CSP has no
  `connect-src`, so the browser *could* call it. It shouldn't: every scan would hand OFF the
  phone's IP and what we eat, the rate limit would count per phone, and we couldn't set a
  proper User-Agent or cache. The lookup goes through the server.

### Scanning on our phones

- **`BarcodeDetector`** works in Chrome on Android. Safari (iOS and macOS, up to 27) has it
  behind a flag, off by default, and broken even when on since iOS 18
  ([WebKit 281848](https://bugs.webkit.org/show_bug.cgi?id=281848)). Firefox has none. So iOS
  needs a JS decoder.
- **Decoder:** [`barcode-detector`](https://github.com/Sec-ant/barcode-detector) (MIT, active,
  last release Oct 2026) implements the same `BarcodeDetector` API on top of `zxing-wasm`, as a
  ponyfill, so one code path covers both. The reader wasm is ~1 MB. By default it loads from
  jsDelivr; we self-host it (`prepareZXingModule({ overrides: { locateFile } })` and a file in
  `public/`) so nothing third-party loads and the service worker can cache it.
  `html5-qrcode` is unmaintained, `@zxing/browser` releases rarely, and quagga2 is weaker on
  EAN in poor light.
- **Camera in the installed PWA on iOS** works (`getUserMedia` in Home Screen apps since 13.4),
  but the permission often resets to "Ask" on each launch
  ([WebKit 327237](https://bugs.webkit.org/show_bug.cgi?id=327237)). Use
  `<video playsinline muted autoplay>`, `facingMode: { ideal: "environment" }`, and stop the
  tracks when the scanner closes.
- **Fallbacks, always shown:** "Take a photo" (`<input type="file" accept="image/*"
  capture="environment">`, decoded with the same `detect()`; no camera permission needed) and
  typing the digits.
- **HTTPS** is there (Caddy). Nothing blocks the camera today (no `Permissions-Policy`), and
  the CSP has no `script-src`, so wasm isn't blocked either; if a `script-src` is ever added
  it needs `'wasm-unsafe-eval'`.

### What the planner assumes today

- A `meal_slots` row always names a Mealie recipe slug; `recipe_cache`, `personDayTotals`,
  `buildShoppingList`, the recipe page and the service worker's offline copy all hang off that.
- **Adherence:** `summariseAdherence` counts every meal up to today with a portion > 0 and no
  log as *unlogged*. A snack added after the fact would show up as a meal someone forgot to
  log, and logging it "stuck to it" would make an unplanned bar improve the score.
- `addMeal` gives every member a portion of 1 (0 when fasting).
- `buildShoppingList` gets nothing from a recipe with no ingredients, so a product as a
  recipe silently stays off the list.

## Decisions (recommended)

### 1. A product is a Mealie recipe

Create one Mealie recipe per product, as the issue's first candidate. Everything downstream
(cache, totals, the recipe page, offline, the "partial nutrition" flags, Mealie's backups)
works unchanged, and the write path is a small sibling of the URL import (`POST /api/recipes`
`{ name }` → slug, then one `PATCH`). A planner-side `products` table with a second branch in
every reader is much more code for a cleaner separation we don't need.

The recipe:

- `name`: "Grenade Carb Killa Caramel Chaos" (brand + product name; the user can edit it on
  the scan sheet), `recipeServings: 1`.
- `nutrition`: **per one serving as we define it** (below), in kcal and grams, the way
  `RecipeNutrition` already reads it. Computing per-serving from per-100 g is arithmetic on the
  label, not an estimate. Missing macros stay blank and the product is flagged `partial`, as
  for recipes. Fibre is often missing from UK packs; that's fine.
- `orgURL`: `https://world.openfoodfacts.org/product/<code>` when OFF had it, which also gives
  the recipe page its "Source" link and the ODbL credit. Empty for a product typed in by hand.
- `extras`: `scrappyProduct: <canonical barcode>`, `scrappyServingGrams`, `scrappyPackGrams`
  (when known), and `scrappyNutrition: source | reviewed` (reviewed when someone changed a value
  on the scan sheet). `scrappyReview: done`: the scan sheet *is* the review.
- A **"Product" tag**, so the Add snack dialog can list products and the search can label them.
  Products **do appear in the normal meal search**, with a "Product" pill. On the Discover page
  they show under the Product tag filter, so the default grid of recipes isn't buried in
  snack bars. The tag (`PRODUCT_TAG`) is not in `RECIPE_TAGS`, so nothing classifies into it
  and the review page leaves it alone.
- Image: optional, `POST /api/recipes/{slug}/image { url }` with OFF's front image (CC BY-SA;
  the Source link covers attribution). Not needed for the first PR.

**Finding a product again by barcode.** Through Mealie's own extras, with no
planner table: `GET /api/recipes?queryFilter=extras.value = "<barcode>"`, then
the detail of each hit confirms `extras.scrappyProduct` (checked against Mealie
3.29: `extras.key_name = X AND extras.value = Y` can match two different extras
of one recipe, so the value is filtered alone). This also covers products typed
in by hand (no `orgURL`), and a recipe deleted in Mealie simply stops matching.

`recipe_cache` gains `product jsonb` (the barcode, serving and pack size, from
the `scrappy*` extras; null for recipes), so the week and the shopping list know
a product from a recipe without another call. Rows cached before it refresh
within the hour, as the other added columns did.

### 2. Barcodes are validated and normalised on the server

A pure `parseBarcode(input)` in `server/domain/barcode.ts`: digits only after stripping spaces,
8, 12, 13 or 14 long, with a valid GS1 check digit; UPC-A (12) is padded to 13 digits, so the
same product scanned as UPC-A or EAN-13 has one key. Only that canonical string goes into the
OFF URL (`encodeURIComponent` all the same). The client runs the same check to show "That
doesn't look like a barcode" before the request.

### 3. The lookup is a server action

`lookupProductAction` (`userAction`, input `{ barcode }`) returns either the existing product
(`{ status: "known", slug, … }`) or a draft from OFF (`{ status: "draft", … }`) or
`{ status: "not-found" }`. It's a server action, not a route, since the page calls it from a
form flow like the importer. The OFF client (`server/openfoodfacts.ts`, `server-only`):

- v3 endpoint with an explicit `fields=` list, 8 s timeout, `User-Agent:
  ScrappyMeals/<app version> (https://github.com/pendolohq/scrappy-meals)`. No new env var.
- The response is parsed with zod; anything unexpected is "not found", never a crash.
- A household-wide limiter (`createRateLimiter`, ~10 a minute), well under OFF's 15, because
  every lookup leaves from the server's IP. OFF down or limiting is a `RetryableError`
  ("Open Food Facts isn't answering; try again in a minute").

**Mapping OFF to a draft** is a pure function with unit tests over recorded responses (the
Snickers, Grenade, Huel, Kind and Fage ones above make good fixtures):

- Per 100 g macros from `_100g`. `kcal` from `energy-kcal_100g`; when only kJ is there,
  kJ ÷ 4.184, shown on the sheet for the user to confirm.
- **A sanity check:** when kcal and 4·protein + 4·carbs + 9·fat (+ 2·fibre) differ by more than
  ~20 %, the sheet says "These numbers don't add up; check them against the pack." Nothing is
  corrected automatically.
- One **serving** = `serving_quantity` g when it's set, in g or ml, and smaller than the pack.
  Otherwise one unit of a multipack ("3 x 60 g" → 60 g). Otherwise the whole pack when it's
  250 g or less (bars, crisps, single pots). Otherwise 100 g. The sheet shows the guess
  ("1 serving = 60 g") and lets the user change it.
- Per-serving values come from per 100 g × serving grams, not OFF's `_serving` values, so there
  is one formula and the serving the user picked is what the numbers mean. Results are rounded
  to one decimal place.

### 4. Logging after the fact: unplanned entries

- `meal_slots` gains **`unplanned boolean not null default false`**. An unplanned entry is
  something eaten off-plan: it is logged as eaten, not planned ahead. That keeps adherence
  meaning "stuck to the plan".
- **Deciding which one it is:** the sheet asks "Already had it?". The answer starts as yes for
  today or an earlier day and no for a future day, and can be flipped. Going by the date alone
  gets two cases wrong: a bar added at breakfast for this afternoon is planned, even though
  it's today; and a snack someone forgot to plan for tomorrow, added a day late, is unplanned.
  The toggle covers both. A future day's entry can't be "already had".
- **Adherence leaves unplanned entries out entirely:** they are neither *unlogged* nor scored
  (`summariseAdherence` skips them; the week grid shows an "Unplanned" pill instead of the log
  buttons). They count in `personDayTotals` like any meal.
- **Who ate it:** a product entry gives a portion of 1 to the person who added it and 0 to
  everyone else, planned or not. Portions stay editable by anyone, as now. It keys on the
  session's `user.id`, never an id from the input. If that person is fasting that day, an
  unplanned entry is still added at 1, since they ate it; a planned one gets 0, like any
  planned meal on a fast.
- **Swaps:** "Swapped" stays a note for now. A follow-up can offer "Log what you had" from the
  swap prompt, which opens the same sheet and adds an unplanned entry.
- The Add snack dialog also lists **recent products** (the Product tag, most recently added
  first), so the second bar of the week is two taps with no scan, and something eaten in the
  shop can be logged at home from that list.

### 5. Portions and units

The base unit is the product's one serving. On the sheet: **"1 serving (60 g)"**, **"½"**,
**"Whole pack (180 g)"** when the pack size is known, and **"Grams…"**. The choice becomes the
entry's `baseServings` (grams ÷ serving grams; `numeric(5,2)` is precise to well under 1 %).
The portion multiplier stays 1 for the eater, so "×2" in the week grid still means "twice what
I usually have". Entering grams is needed: half the products have no serving on OFF.

### 6. Shopping list

Planned products (not unplanned ones: those are already eaten) go on the week's list as
themselves: "Grenade Carb Killa ×3". `buildShoppingList` gets a branch for meals whose recipe
has a barcode, adding a free-text line with `ceil(servings eaten)` summed over the week. They are
free text in Mealie, so they don't merge with ingredients. That's the right call: a bar isn't
flour.

### 7. Offline

No queue. A scan needs OFF and our server, so offline the sheet says "No signal: try again when
you're back online", and keeps the barcode filled in so retrying is one tap. The recent
products list covers the common case of logging later. A queued, unresolved barcode would need a
second review step later for little gain.

### 8. Sending missing products back to Open Food Facts

When OFF doesn't know a product, or knows it without nutrition (the Huel bar, the empty Dairy
Milk record), what we type from the pack goes to OFF too, so the next scan anywhere finds it.

- **One app account.** OFF's guidance for apps is a dedicated account (plus its API usage form)
  rather than one account per user. Its username and password come from two new optional
  variables, `OFF_USER_ID` and `OFF_PASSWORD`. Each goes into `.env.example`, `docker-compose.yml`
  and `docs/deploy.md`, and is read only in `server/openfoodfacts.ts`. Without them,
  contributing is off and nothing else changes. Test writes go to staging
  (`world.openfoodfacts.net`), which has its own accounts.
- **The write:** `POST /cgi/product_jqm2.pl` (form fields), with `code`, `user_id`, `password`,
  `product_name`, `brands`, `quantity`, `serving_size`, `nutrition_data_per=100g`,
  `nutriment_energy-kcal`, `nutriment_proteins`, `nutriment_carbohydrates`, `nutriment_fat`,
  `nutriment_fiber` (each with a `_unit`), and `app_name`, `app_version` and `app_uuid`.
  OFF asks for `app_uuid` to be a salted random id per user, so a moderator can block one
  person without blocking the app; we derive it from the user's id and `AUTH_SECRET`.
- **Per 100 g, as printed.** UK packs always print per 100 g, so the sheet's manual entry (PR 1) asks
  for that column plus the serving size, and we work out per serving ourselves. That's also
  what OFF wants.
- **Only fill gaps, never correct.** We send new products and fields OFF has empty. We never
  overwrite a value OFF already has, even one that looks wrong (the Kind bar's kJ): a household
  app shouldn't make public corrections without a photo to back them. The change stays in our
  copy in Mealie.
- **Asked every time.** A tick box on the sheet, "Also add to Open Food Facts (public,
  ODbL)". It's on by default when the account is configured, and the choice is remembered on
  the device. Only product data is sent: no user names and nothing about who ate it.
- **Not on the critical path.** The Mealie save happens first; the OFF write runs after the
  response (`after()`), with one retry on a network error, 429 or 5xx, as OFF recommends. The
  outcome is kept in an `off_contributions` row (barcode, status, error, time). A failed one
  shows "Not sent to Open Food Facts yet: retry" on the product's recipe page.
- **Photos, later.** OFF moderators trust products with a front and a nutrition-table photo
  more. Taking those two photos (uploaded with `/api/v3.3/product/<code>/images`) is a
  follow-up. Reading nutrition from the photo stays out of scope.

### Out of scope

As in the issue: reading nutrition from a photo of the label, and products used inside recipes.
Also editing a product's nutrition from the planner after it's saved; Mealie's editor and the
existing review page cover that.

## Implementation: four PRs

### PR 1: products by typed barcode (the core)

- [x] `server/domain/barcode.ts`: `parseBarcode` (check digit, UPC-A → EAN-13). Unit tests.
- [x] `server/openfoodfacts.ts`: v3 client, zod parse, UA, timeout (the limiter is in `server/products.ts`). Unit tests with an
      injected `fetch` and recorded fixtures (no network in tests).
- [x] `server/domain/product.ts`: OFF → draft (serving rule, per-serving maths, kJ fallback,
      sanity warning). Unit tests over the fixtures.
- [x] `server/mealie/products.ts`: create the recipe (`POST` + `PATCH` with nutrition,
      servings, `orgURL`, extras via a `withProductState` like `withImportState`, the Product
      tag). Integration test in `mealie.int.test.ts`. `Recipe` and `recipe_cache` gain
      `product`.
- [x] Migration: `meal_slots.unplanned`, `recipe_cache.product`.
- [x] `server/plan.ts`: `addMeal` for products (portion 1 for the adder, 0 for the others; `unplanned`
      from the sheet's "Already had it?", refused for a day after the viewer's today).
      `summariseAdherence` skips unplanned entries. DB tests for both.
- [x] Actions `lookupProductAction`, `saveProductAction` (`userAction`, zod). They show up in
      `access.test.ts` automatically.
- [x] UI: an Add snack dialog with a "Product" tab: barcode field, the sheet (name, the
      macros per 100 g, editable, serving size, portion choice, OFF credit link), recent
      products. "Unplanned" pill in the week grid and day card. A "Product" pill in the meal
      search; on Discover, products only under the Product filter.
- [x] Per-100 g manual entry on the sheet: macros typed from the pack, with the serving size,
      for products Open Food Facts lacks or has without nutrition.
- [x] `docs/mealie-api.md`: the product recipe's fields and the endpoints used.
- No new e2e journey: the parts unit and DB tests can't reach are the camera (PR 2) and OFF
  itself, which CI can't call. Optionally, add one step to Alex's journey later, logging a
  known product from the recent list.

### PR 2: camera scanning

- [x] `bun add --exact barcode-detector@latest`; native `BarcodeDetector` when
      `getSupportedFormats()` includes `ean_13`, else the ponyfill, imported lazily when the
      scanner opens so the rest of the app doesn't load it.
- [x] Self-host the reader wasm in `public/`; the service worker caches it. Check how it
      lands in the standalone image (`.github/image-paths`).
- [x] Scanner component: live video (formats `ean_13`, `ean_8`, `upc_a`, `upc_e`), the photo
      fallback, digits always available; stops the camera on close.
- [ ] Try it on an iPhone (Home Screen app) and an Android phone.
- [x] Optional hardening in the Caddyfile: `Permissions-Policy: camera=(self), microphone=(),
      geolocation=()` (with `docs/deploy.md`).
- Learned: the wasm file name carries the zxing-wasm version
  (`/zxing/zxing_reader.<version>.wasm`, written by `scripts/copy-wasm.mjs` on `dev` and
  `build`, gitignored), so an upgrade is a new URL and a unit test checks the file against
  the version and SHA-256 the library expects. The worker caches `/zxing/` cache-first.

### PR 3: contributing to Open Food Facts

- [ ] `OFF_USER_ID` / `OFF_PASSWORD` (optional) in `.env.example`, `docker-compose.yml` and
      `docs/deploy.md`.
- [ ] The write in `server/openfoodfacts.ts` (gaps only, per 100 g, `app_uuid` per user),
      the `off_contributions` table, the run after the response with one retry, and "retry"
      on the recipe page. Unit tests with an injected `fetch`. Try it once by hand against
      staging.
- [ ] The tick box on the sheet (the per-100 g manual entry it sends shipped in PR 1).

### PR 4: follow-ups

- [ ] Shopping: planned products as "Name ×N" free-text lines; unit test in
      `domain/shopping.test.ts`.
- [ ] "Log what you had" from the Swapped prompt.
- [ ] Product photo from OFF on the recipe; taking front and nutrition photos for OFF.

## Settled

- Products appear in the normal meal search (with a "Product" pill).
- Missing products and empty fields are sent back to Open Food Facts (§8).
- Planned vs unplanned is the "Already had it?" toggle, defaulting from the date (§4).
