# Review fixes

Findings from the October 2026 whole-repo review (correctness, security, simplicity, best
practices, ops), tiers 1–4. Run with `/execute-tasks tasks/review-fixes.md`.

Ground rules for every task:
- Simplicity wins. If a fix needs more machinery than the problem is worth for one household,
  stop and ask instead of building it.
- Follow AGENTS.md (security rules, verification commands, `next-dev-loop` for anything visible).
- Each milestone below is one PR. Tasks inside a milestone are commits.

Decisions already taken:
- Shop queue: strip it back to "append and replay" (no folding, no in-flight tracking, no
  `clientId` dedupe, no cross-tab sync).
- "Shopping" and "Shop" become one page (see M5). Confirmed.
- No server is deployed yet. Nothing here needs one: everything is checked locally or in CI.
- CI: keep the path filter that decides whether to build the image, but make it correct and
  checked by a test (M10). Don't build the image on every PR.

---

## M1 — Ops and deploy (no app code)

- [x] **Task 1: `.env.example` comments on their own lines**
  **Complexity:** XS
  **Why:** Compose reads `S3_ENDPOINT=   # leave empty for AWS` as the value
  `# leave empty for AWS` (reproduced with `docker compose config`). Every AWS backup fails and
  `BACKUP_PING_URL` breaks too.
  **Do:** move every inline comment in `.env.example` onto the line above its variable. Add a
  line at the top: "Don't put comments after a value: Compose reads them as part of it." Add
  `MEALIE_IMAGE` (used in `docker-compose.yml:48`) with a comment. In `docs/deploy.md`, add a
  post-setup check: `docker compose config | grep -E 'S3_ENDPOINT|BACKUP_PING_URL|MEALIE_API_TOKEN'`.
  In `docs/aws-backup-setup.md`, name `S3_BUCKET` and `S3_REGION`, and say that its `AWS_REGION`
  must equal `S3_REGION`.
  **Done when:** no `.env.example` line has `=` followed by whitespace and `#`; `docker compose
  config` with a copy of `.env.example` shows empty values.

- [x] **Task 2: Backup tolerates files changing under it**
  **Complexity:** XS
  **Do:** `backup/ops.sh:52`: add `--warning=no-file-changed --warning=no-file-removed` and treat
  tar's exit code 1 as success (`|| [ $? -eq 1 ]`). Add `set -o pipefail` (BusyBox ash supports
  it) so a failing `aws` in the `fetch` pipeline doesn't show up as "no backup found".
  **Done when:** `sh -n backup/ops.sh` passes; the reasoning is in a one-line comment.

- [x] **Task 3: Backup work dir on disk, not in RAM**
  **Complexity:** XS
  **Do:** in `docker-compose.yml`, replace the ops services' `tmpfs: /tmp` with an anonymous
  volume (e.g. `/work`) and `TMPDIR=/work`. Encrypt by streaming (`tar … | age -o …`, `pg_dump |
  age`) wherever that is simple, so no plaintext copy sits next to the encrypted one. Recompute
  `SHA256SUMS` over the plaintext via `tee`, or move it to the encrypted files if that's simpler,
  and update `restore` to match.
  **Done when:** a backup and restore round trip works (see Task 6).

- [x] **Task 4: Restore can't pick a partial run, is atomic, and cleans up on Ctrl-C**
  **Complexity:** S
  **Do:**
  - `ops.sh backup`: upload a `COMPLETE` marker last. `fetch latest` only considers runs that
    have it, and refuses prefixes dated in the future.
  - Print each object's `LastModified` in the restore confirmation.
  - `pg_restore --single-transaction`, connected as the app role (`PGUSER=$db` with that role's
    password) rather than `postgres`, so a crafted archive can't use `RESET ROLE` to gain
    superuser rights. Task 6's round trip shows whether this works for Mealie's DB, which may
    use extensions only a superuser can create. If it doesn't, keep `postgres` for the Mealie DB
    only and say why in a comment.
  - `scripts/restore.sh`: add `trap 'exit 130' INT TERM HUP` next to the EXIT trap (dash doesn't
    run EXIT on signals). Add a failure message saying which services are stopped and how to
    start them again.
  - `docs/aws-backup-setup.md`: correct "a compromised VPS leaves backups intact" to describe
    what is and isn't protected.
  **Done when:** Task 6 passes.

- [x] **Task 5: Deploy docs that actually deploy**
  **Complexity:** S
  **Do:** in `docs/deploy.md` §7 and `docs/README.md`:
  - Deploy is `git fetch --tags && git checkout vX.Y.Z && docker compose pull && docker compose
    up -d --wait`, then `docker compose restart caddy` if the Caddyfile changed (it's
    bind-mounted as a file, so the container keeps the old inode).
  - §4 first Mealie setup: start `postgres mealie` only and reach Mealie through
    `ssh -L 9000:localhost:9000` plus a temporary `127.0.0.1:9000:9000` port (or whatever is
    simplest and works). Change the default admin login, then start Caddy.
  - Create the planner's API token on a dedicated non-admin Mealie user in the household, not
    on the admin account. Check that it can read recipes and write shopping lists; if Mealie
    needs more rights for that, document what.
  - Add a short "Rebuild from scratch" section: clone, `.env` from the password manager,
    `scripts/restore.sh`, `docker compose up -d`. Recommend keeping `.env` in the password
    manager next to the age identity.
  - Backup cron runs as `deploy` in both deploy.md and aws-backup-setup.md. Make the healthchecks
    ping a recommended step in deploy.md §6. Use `age-keygen -y` to get the recipient.
  - Note that if the backup on the 1st fails, re-run it by hand so the month gets its monthly
    copy.
  - Remove the duplicate user-commands table: keep the one in deploy.md and link to it from
    README.
  **Done when:** every command in §4–§7 runs as written against a local `docker compose`
  stack (no server exists yet).

- [x] **Task 6: CI runs a backup and restore round trip**
  **Complexity:** M
  **Depends on:** Tasks 2, 3, 4
  **Do:** add a CI job, path-filtered on `backup/`, `scripts/`, `docker-compose.yml` and
  `postgres/`. It starts Postgres (with `postgres/init` mounted and real role passwords), a MinIO
  service container and a throwaway age key. It seeds a row in each DB, runs `ops backup`,
  `fetch latest`, `restore-db` and `restore-files`, then checks the row counts. Keep it as one
  short shell script.
  **Done when:** the job passes and fails if you break `restore-db`.

- [x] **Task 7: Compose and Caddy hardening**
  **Complexity:** S
  **Do:**
  - An `x-logging` anchor (json-file, `max-size: 10m`, `max-file: "3"`) on every service.
  - Postgres healthcheck `pg_isready -h 127.0.0.1 -U postgres`, so it isn't healthy while the
    init server runs.
  - Caddyfile, app site: `Content-Security-Policy "frame-ancestors 'none'; base-uri 'self';
    object-src 'none'"` and `X-Frame-Options DENY`. No script-src for now.
  - ~~Caddy only serves `/api/health` to local addresses.~~ Skipped: deploy.md §8 points an
    uptime monitor at it, which is worth more than hiding it. Task 12 makes it cheap.
  **Done when:** `docker compose config -q` passes; deployed headers checked with `curl -I`.

- [x] **Task 8: Image and CI hygiene**
  **Complexity:** S
  **Do:**
  - `ci.yml`: `latest` only for tags without `-` (no prereleases).
  - The image smoke test runs with `postgres/init` mounted and connects as `planner`, not as the
    superuser.
  - Push the image that was smoke-tested (retag the loaded one) instead of rebuilding it.
  - Pin GitHub Actions to commit SHAs and base images (`node`, `caddy`, `postgres`) to
    `@sha256` digests. Add a Dependabot config for `github-actions` and `docker` so they get
    bumped.
  - `app/Dockerfile`: app files owned by root; only what the server writes to (`.next/cache`, if
    anything) owned by `node`.
  - One line in deploy.md: the image is amd64 only.
  - The ops image (`build: ./backup`) is built once and never rebuilt. Add `--build` (or
    `docker compose build ops`) to the deploy command from Task 5 so it picks up changes.
  **Done when:** CI is green on a PR that touches the Dockerfile.

## M2 — When Mealie is down

- [x] **Task 9: One "Mealie unavailable" check**
  **Complexity:** S
  **Do:** in `server/mealie/client.ts`, catch network and abort errors in the fetch wrapper and
  rethrow them as `MealieUnavailableError` (with the original as `cause`). Only undici's
  `fetch failed` and timeouts count, not every `TypeError`, so code bugs aren't retried forever.
  Export `isMealieUnavailable(err)`, true for that error and for `MealieError` 5xx/429. Use it in:
  - `shop/page.tsx`, which currently crashes when Mealie is stopped;
  - `shopping/actions.ts`, which currently shows a generic error;
  - `shop/actions.ts` (`isTransient`).
  Delete the `(err as Error).name` checks.
  **Done when:** unit test for the classifier; with the Mealie container stopped, the shop page
  shows its "isn't reachable" banner (`next-dev-loop`).

- [x] **Task 10: Adding a meal while Mealie is down says so**
  **Complexity:** XS
  **Depends on:** Task 9
  **Do:** `loadRecipes(…, { force: true })` (`recipe-cache.ts:78-83`) stops swallowing fetch
  errors. `addMeal` then lets the unavailable error surface as a `PlanError` "Mealie isn't
  reachable" instead of "Recipe not found".
  **Done when:** db test with a fetch that throws.

- [x] **Task 11: Error boundaries**
  **Complexity:** XS
  **Do:** `src/app/(app)/error.tsx` (client: message, retry button, link to `/week`) and a
  minimal `src/app/global-error.tsx`. Check the bundled Next 16 docs for the current props
  (`reset` vs `unstable_retry`).
  **Done when:** a thrown error in a page shows the boundary (`next-dev-loop`).

- [x] **Task 11b: A database blip doesn't sign everyone out**
  **Complexity:** S (auth: gets a review pass)
  **Found while verifying Task 11:** the `jwt` callback in `auth.ts` checks the session
  version against the database on every request. When that query throws (Postgres
  restarting), Auth.js drops the session cookie, so everyone who opens the app during
  the outage is signed out for good.
  **Do:** if the lookup throws, keep the token and log the error. Data pages fail on their
  own queries anyway, so nothing is served from a session that should have been revoked.
  A removed user or a changed password still ends the session as soon as the database
  answers again.
  **Done when:** unit or db test; with Postgres stopped then started, the browser is still
  signed in.

- [x] **Task 12: Health check that only the DB can fail**
  **Complexity:** XS
  **Depends on:** Task 9
  **Do:** `api/health/route.ts`: run the DB and Mealie checks in parallel, give Mealie its own
  client with a ~2 s timeout, and log the version-mismatch warning once per process.
  **Done when:** unit or route test; a hung Mealie doesn't fail the response.

- [x] **Task 13: Week page doesn't wait on Mealie for stale recipes**
  **Complexity:** S
  **Do:** `loadRecipes` returns cached rows straight away and refreshes stale ones in `after()`
  (`next/server`; check the bundled docs). It only fetches inline for slugs with no cached row.
  The `force` path stays synchronous. Also have `getWeekPlan` hand the recipes it loaded to
  `weekShoppingList` so the shopping page doesn't load them twice. Drop the unused `maxAgeMs`
  option.
  **Done when:** existing db tests pass; new test that a stale row is returned without a fetch.

## M3 — Pushing to Mealie

- [x] **Task 14: A failed push tells the truth**
  **Complexity:** XS
  **Do:** `shopping/actions.ts`: replace "Nothing was changed on our side" with "The list may be
  partly updated. Send it again." Give the `create-bulk` call a longer timeout (30 s).
  **Done when:** the message is updated and the timeout is set.

- [x] **Task 15: Re-push doesn't inflate hand-added items**
  **Complexity:** S
  **Do:** Mealie merges a pushed line into an existing unchecked item with the same food and
  unit and returns it in `updated`, which `pushShoppingList` (`server/shopping.ts:153`) ignores.
  Do the simplest thing that stops repeated inflation: show a warning on the shopping page when
  `updated` isn't empty ("N items were merged into lines already on the list; check their
  quantities"). Only try to track and subtract the planner's share if that turns out to be
  small. Fix the "merging only ever combines its own lines" claim in `docs/mealie-api.md`.
  **Done when:** integration test pushing into a list with a hand-added item of the same food
  and unit.

- [x] **Task 16: One Mealie read per tick**
  **Complexity:** XS
  **Do:** `itemOnWeekList` returns Mealie's raw item. `setShoppingItemChecked(current, checked)`
  writes it back and returns `void`. `checkShopItemAction` returns `{}`. Delete the
  merge-aware result picking (`mealie/shopping.ts:180-184`) and the "Ticking (cont.)" doc bullet.
  The integration test asserts on a re-read item.
  **Done when:** tests pass; a tick makes two Mealie calls.

## M4 — Shop queue: append and replay

- [x] **Task 17: Simplify the queue**
  **Complexity:** M
  **Do:**
  - `enqueue` always appends. Remove folding and `inFlightId`, the module-level `inFlight` map,
    and their tests. Keep `replaceTempId`.
  - Remove `clientId`: `addShopItem(db, weekStart, note)`, no extra list GET, no `CLIENT_ID`
    extras, and remove the regex in `shop/actions.ts`.
  - `shop-queue-store.ts`: `load()` is `try { JSON.parse } catch { [] }`. No `isChange` guard,
    no `storage` listener.
  - ~~`dropFailed` becomes a plain filter by id.~~ Kept as is: without the cascade, the
    dependants of a failed add would each show a confusing "Invalid input".
  - Retry on a 10 s interval and on `online`; drop `focus`.
  - A remove that gets a 404 counts as success.
  - A Mealie 401/403 (revoked token) or a database error stops the run and keeps the queue,
    like a transient error, instead of dropping every queued change one by one.
  - Errors from dropped changes stay visible until dismissed (today the next success clears
    them).
  - Rewrite the "Offline and retries" section of `docs/mealie-api.md` in about three lines.
  **Done when:** unit tests for the reducers; e2e offline tick-then-reconnect still passes.

- [x] **Task 18: `flush` is testable**
  **Complexity:** S
  **Depends on:** Task 17
  **Do:** move `flush` out of `shop-checklist.tsx` into `lib/shop-list.ts` (or
  `lib/shop-flush.ts`), with `send`, `read`, `write` and `isOnline` passed in. Unit-test four
  cases:
  - a retryable error stops the run;
  - a non-retryable error drops the change and reports it;
  - a temp id is replaced;
  - a change queued during a send survives.
  **Done when:** those tests pass.

## M5 — One shopping page

Today:
- **Shopping** (`/week/X/shopping`) works out what the week's plan needs and has the
  "Send to Mealie" button.
- **Shop** (`/week/X/shop`) is the checklist over that Mealie list that you tick in the store,
  offline included.

They become one page.

- [x] **Task 19: Merge Shopping and Shop**
  **Complexity:** L
  **Depends on:** Tasks 9, 16, 17
  **Do:** one route, `/week/X/shopping`.
  - Before the first push it shows the preview, warnings and "Send to Mealie".
  - After a push it shows the checklist, an "Update from plan" button (re-push) and a
    collapsed "What the plan needs" preview with the warnings.
  - `/week/X/shop` redirects to it (installed PWAs may have it cached).
  - The week page has one "Shopping" link.
  - Split `server/shopping.ts` into build/push (`shopping.ts`) and checklist (`shop.ts`).
  - Rename the domain `ShoppingList` type to `WeekIngredients`. Have
    `findShoppingListByName`/`createShoppingList` return just the id.
  - Update the e2e and `docs/mealie-api.md`.
  **Done when:** e2e covers preview → send → tick; `next-dev-loop` on a phone viewport.

- [x] **Task 20: Shared week header and week param**
  **Complexity:** S
  **Depends on:** Task 19
  **Do:** a `<WeekHeader weekStart title back>` server component for the prev/next arrows, title
  and back link, used by the week, shopping and adherence pages. Export a `weekStartSchema` from
  `server/domain/week.ts` (used by every action that takes a week) and a
  `canonicalWeek(weekStart, suffix)` helper that does the redirects. `requireUser()` comes
  first on every page.
  **Done when:** the pages are visually unchanged (`next-dev-loop`).

## M6 — PWA and offline

- [x] **Task 21: Opening the installed app offline shows this week**
  **Complexity:** S
  **Do:** `sw.js`: when a navigation to `/week` (or `/`) fails, serve the cached
  `/week/<this Monday>` (computed in local time), falling back to `/offline`. Fix the offline
  page's link so it doesn't loop. After M5, also cache `/week/<monday>/shopping`.
  **Done when:** e2e step: go offline, `goto("/week")`, see the cached week.

- [x] **Task 22: Cached pages don't outlive the session**
  **Complexity:** S
  **Do:**
  - `sw.js`: when a page bounces to `/login?next=…` (no session), delete the `PAGES` cache.
    (A navigation's redirect is opaque to the service worker, so the bounce is what it sees.)
  - ~~Send `Clear-Site-Data` from the sign-out response.~~ Skipped: a server action can't set
    it, and sending it from `/login` would wipe unsaved offline ticks whenever a session
    expires. The login-bounce cleanup covers the same risk.
  - Cap the `STATIC` cache, for example by evicting the oldest entries past 200.
  - Rename `clearCachedPages` to `clearDeviceData`.
  **Done when:** e2e: sign out → offline → the week is not served.

## M7 — Forms and accessibility

- [ ] **Task 23: Forms keep what the user typed after an error**
  **Complexity:** S
  **Do:** login and settings actions return the submitted values with the error, and the
  fields use them as `defaultValue`. Check the bundled Next/React docs for the current
  recommended pattern first. Add `max` attributes matching the zod bounds in settings.
  **Done when:** e2e: a wrong password keeps the email.

- [ ] **Task 24: Touch targets, contrast, loading state**
  **Complexity:** S
  **Do:**
  - Adherence buttons, steppers and the `⋯` menu get touch targets of about 40–44 px.
  - Offline banner `dark:text-stone-900`.
  - A skeleton `week/[weekStart]/loading.tsx`.
  - `AutoRefresh` listens to `visibilitychange` only.
  **Done when:** `next-dev-loop` on a phone viewport in light and dark mode.

## M8 — Security hardening

- [ ] **Task 25: `access.test.ts` has no blind spots**
  **Complexity:** S
  **Do:**
  - Check every `page.tsx`/`layout.tsx` under `src/app` except an explicit public list
    (`login`, `offline`, the root layout).
  - Fail on any `"use server"` that isn't on a file's first line. Move the sign-out action in
    `(app)/layout.tsx` into an actions file built with `userAction`.
  - Broaden the import regex to catch namespace and default imports.
  **Done when:** the test fails when you add an unguarded page in a new route group.

- [ ] **Task 26: Small input tightening**
  **Complexity:** XS
  **Do:**
  - `safeNext` rejects `\` and control characters (or compares `new URL(next, base).origin`).
  - The image proxy only accepts `image/webp`.
  - `addMealAction`'s slug matches `^[a-z0-9-]+$`.
  - Servings and targets have zod minimums that survive the numeric rounding (≥ 0.01 / ≥ 0.1),
    so tiny values don't hit the DB check or read as "no target".
  **Done when:** unit tests for `safeNext` and the schemas.

- [ ] **Task 27: Sign-in limits can't lock the household out**
  **Complexity:** S
  **Do:**
  - Count per-email failures per (email, IP) pair, with a higher global per-email ceiling (for
    example 50 per 15 minutes).
  - Successful sign-ins don't count against the per-IP limit.
  - IPv6 is out of scope. At worst, a sign-in shows "Too many attempts" for 15 minutes, and
    sessions last 30 days.
  **Done when:** unit tests in `rate-limit.test.ts`.

## M9 — Cleanup

- [ ] **Task 28: Remove dead code and duplicates**
  **Complexity:** S
  **Do:**
  - Delete code only tests use: `isUserFasting` (test through `getWeekPlan`) and
    `AdherenceSummary.due`.
  - Delete options nobody passes: `createMealieClient`'s `timeoutMs`/`fetch` (unless Task 12
    uses `timeoutMs`).
  - Delete what nothing reads: recipe-search pagination (return items only),
    `Ingredient.referenceId`/`title`, the unreachable `if (!user)` in `settings/page.tsx`.
  - Make `servingsEaten` non-exported.
  - Dedupe:
    - `lastPush` query;
    - `BUTTONS` → `ADHERENCE_STATUSES`;
    - `SLOT_LABEL` vs `SLOTS`;
    - `MONTHS` (use `lib/format.ts`);
    - `Result` → `ActionResult`;
    - test DB setup in `users.db.test.ts` and the TRUNCATE list in e2e global setup.
  - Drop redundant `export const dynamic = "force-dynamic"`, the `inArray` with one element and
    the `auth.ts:88` cast (add `sv` to the `User` augmentation).
  **Done when:** all checks green; Grep shows no remaining references.

- [ ] **Task 29: Drop the `addMeal` retry loop and the redundant index**
  **Complexity:** S
  **Do:** remove the `23505` retry loop in `plan.ts:291-334`; a collision falls through to
  "Something went wrong". In one migration:
  - drop `meal_slots_date_idx`;
  - drop `recipe_cache.mealie_updated_at` and `Recipe.updatedAt`;
  - replace `image_path` with `has_image`.
  Generate it with drizzle-kit.
  **Done when:** db tests pass; CI's migration-drift check passes.

- [ ] **Task 30: Rare correctness quirks**
  **Complexity:** S
  **Do:**
  - `nutrition.ts`: a comma followed by exactly three digits ("1,200") is treated as missing,
    not as 1.2. Add a test.
  - Renamed recipes. First find out, with an integration test against the CI/local Mealie
    (`MEALIE_TEST_URL`), whether renaming a recipe through the API changes its slug and makes
    the old slug 404. Keep that test either way, so a Mealie upgrade that changes the behaviour
    is caught.
    - If the slug changes: on a 404, `recipe-cache.ts` retries with the cached `mealieId`
      (Mealie's GET accepts an id) and updates the slug in `meal_slots`.
    - If it doesn't change: no code change.
  - Fasting defaults: make the settings text accurate (changing defaults affects past weeks
    and doesn't zero meals already planned). Don't build history snapshots.
  - Free-text "(×N)" counts recipes, not repeated lines within one recipe.
  **Done when:** unit tests for the nutrition and free-text changes.

- [ ] **Task 31: Docs, agent files and dependencies**
  **Complexity:** S
  **Do:**
  - AGENTS.md "Workflow" matches `execute-tasks.md` (direct by default, full round for
    L/risky).
  - `.claude/agents/implementer.md` says to always use the `/simplify` skill, which Cursor
    doesn't have; make it Claude Code only or drop it. Remove the `vercel-composition-patterns`
    skill if nothing uses it (`pnpm skills:update` flow, not a hand edit).
  - Merge the two "Ticking" bullets in `docs/mealie-api.md` if Task 16 hasn't already.
  - Remove the valtiberina references (`README.md:111`, `update-packages.ts:4`).
  - Fix the stale comments in `schema.ts:54` and `scripts/mealie-types.mjs:6`.
  - `MEALIE_SCHEMA_VERSION` is read from `openapi.json`'s `info.version`, so the Mealie version
    lives in compose, CI and openapi only.
  - `@types/node` → `^22`.
  - Either pin the `^` deps exactly or relax the AGENTS.md rule, whichever is less churn.
  - DB and integration vitest projects fail loudly when their env var is missing instead of
    skipping.
  **Done when:** all checks green.

## M10 — CI image filter that stays correct

- [ ] **Task 32: Fix and test the "does this PR affect the image" check**
  **Complexity:** S
  **Why:** the hand-kept `PATTERN` in `ci.yml` (`changes` job) is meant to catch what the e2e
  job doesn't already exercise: the Dockerfile and its inputs, dependencies, migrations and
  the bundled CLI/migrator. The CLI part is already wrong: `src/server/errors.ts` is bundled
  but not listed. It will drift again with every new import.
  **Do:**
  - Move the pattern into `.github/image-paths` (one regex per line, with comments) and read it
    in the `changes` job.
  - `build-cli.mjs` writes an esbuild metafile.
  - Add a unit test that bundles the CLI and migrator with `metafile: true` and fails if any
    input under `src/` isn't matched by `.github/image-paths`, naming the missing paths.
  - Also add `backup/`, `postgres/`, `docker-compose.yml` and `Caddyfile` to the filter (they
    were never checked), plus a `docker compose config -q` step with `.env.example`.
  **Done when:** the test fails if you remove `src/server/errors.ts` from the file; a PR that
  only touches a page still skips the image job.

---

## Not doing (raised in the review, deliberately skipped)

Not worth the code for one household, or already covered by something above:

- IPv6 sign-in limits (see Task 27).
- Restore: checking that each S3 key has only one version. Refusing future dates and showing
  `LastModified` (Task 4) cover the realistic case.
- Tagging planner items in Mealie via `extras` so a push can find them without the DB row
  (Task 14 only fixes the message and timeout).
- Two tabs sending the same queued change, now that cross-tab sync is gone (Task 17). Worst
  case: a duplicate line.
- A shop queue left in `localStorage` after a week's Mealie list is re-created. It's cleared on
  sign-out.
- Two people pushing the same week for the first time at the same moment.
- Locking concurrent migration runs. There is only one app container.
- Splitting the Compose network so Mealie can't reach Postgres. Both need credentials anyway.
- Replacing `revalidatePath` with Next 16's `refresh()`. Unverified, and nothing is wrong
  today.
- Replacing `app/scripts/update-packages.ts` with `pnpm outdated`.
- Backfilling fasting history when defaults change (Task 30 fixes the text only).
