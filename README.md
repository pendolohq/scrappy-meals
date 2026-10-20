# scrappy-meals

Self-hosted meal planner for a household, built on [Mealie](https://mealie.io).
Mealie stores recipes, nutrition and shopping lists; the planner (Next.js)
handles the shared weekly plan and talks to Mealie only through its REST API.

- **Shared week**: one plan for everyone, a column per person with daily
  kcal / protein / carbs / fat / fibre against their own targets.
- **Per-person portions**: pick recipes from Mealie into breakfast, lunch,
  dinner or snacks, and set how much each person eats (0 = not eating it).
- **Fasting days**: per person, by weekday or for one day; portions default
  to 0 and targets are hidden.
- **Honest numbers**: nutrition comes from Mealie only. Recipes with missing
  data are flagged and totals marked incomplete; the planner never estimates.
  AI-estimated values from an import are labelled "estimated" until reviewed.
- **Add recipes by URL**: paste a recipe page's address and Mealie imports it,
  keeping the address as the recipe's source. A review page then shows the
  parsed ingredients (uncertain lines highlighted), servings and nutrition to
  check before the recipe counts as done; the plan flags it until then.
- **Shopping list**: the week's ingredients scaled by everyone's portions,
  merged by food and unit, and sent to a Mealie shopping list.
- **Shop from the planner**: once sent, the same page is a checklist over that
  Mealie list, grouped by aisle, with quick-add; ticks made without signal
  save once you're back online, and both phones see each other's ticks.
- **Adherence**: one tap per meal (stuck / partly / skipped / swapped) and a
  weekly summary.
- **Installable**: mobile-first PWA; recently viewed weeks work offline.

## Layout

| Path | What |
|---|---|
| `docker-compose.yml` | Postgres 18, Mealie, the app, Caddy, plus on-demand `backup` / `restore` services |
| `docker-compose.dev.yml` | Local development only: Postgres and Mealie on localhost, set up by `scripts/dev-up.sh` |
| `Caddyfile` | `app.<domain>` → app, `recipes.<domain>` → Mealie, automatic HTTPS |
| `postgres/init/` | First-boot script: separate role + database for `planner` and `mealie` |
| `backup/` | Image and script for encrypted nightly backups to S3 |
| `scripts/` | Host-side `backup.sh` (cron) and `restore.sh` |
| `docs/aws-backup-setup.md` | One-time S3 bucket, lifecycle and IAM setup |
| `app/` | Next.js app; Mealie client in `app/src/server/mealie/` |
| `docs/mealie-api.md` | What we rely on in the Mealie API, incl. nutrition semantics |
| `docs/deploy.md` | Step-by-step deployment on a VPS |
| `docs/security.md` | How sign-in is enforced for pages, server actions and API routes |
| `docs/README.md` | How the pieces fit and how a commit reaches the server; index of the docs |
| `AGENTS.md`, `.agents/`, `.claude/` | Instructions, skills and subagents for AI coding agents |

Only Caddy publishes ports. Postgres and Mealie are reachable only on the
Compose network; the app calls Mealie at `http://mealie:9000` with a
server-side API token.

## Deploying

See **[docs/deploy.md](docs/deploy.md)** for the full guide (server, DNS,
configuration, Mealie setup, users, backups, updates). In short:

```sh
cp .env.example .env && chmod 600 .env     # fill in domain + secrets
docker compose up -d postgres mealie       # set up Mealie + an API token first (docs/deploy.md §4)
docker compose up -d
docker compose exec app scrappy user add   # once per person
```

## Users

There is no sign-up page and no default account. Accounts exist only once
someone with shell access to the server creates them:

| Command | |
|---|---|
| `scrappy user add [--name N] [--email E]` | create a user |
| `scrappy user passwd EMAIL` | set a new password; signs out that user's sessions |
| `scrappy user list` | list users |
| `scrappy user remove EMAIL` | delete a user and their portions/adherence |

Run them with `docker compose exec app scrappy ...`. Passwords are read from
a hidden prompt (or stdin when piped) and stored as argon2id hashes; they
never go into env vars, files or logs. Failed logins are rate-limited per email and
per IP.

## Backups

Every night `scripts/backup.sh` runs the `backup` service, which:

- dumps the `planner` and `mealie` databases (`pg_dump -Fc`) and the roles,
- tars the Mealie data volume (recipe images and assets),
- encrypts each file with [age](https://age-encryption.org) to a public key,
- uploads to `s3://<bucket>/daily/YYYY/MM/DD/<time>/`, and on the 1st of the
  month also to `monthly/YYYY/MM/<time>/`,
- checks that every object arrived.

The VPS's AWS key can only upload and list, and the bucket has Object Lock,
so a compromised VPS can neither read nor delete existing backups. The age
private key never lives on the VPS. Retention (30 days of dailies, 12
monthlies) is handled by an S3 lifecycle rule.

Restore with `scripts/restore.sh` using read credentials and the age key;
see `docs/aws-backup-setup.md` §6.

## Development

Run it locally against throwaway Postgres and Mealie containers
(`docker-compose.dev.yml`, published on localhost only):

```sh
scripts/dev-up.sh     # starts them, writes app/.env.local, migrates, asks for your first login
cd app && bun run dev # http://localhost:3000
```

Mealie is at http://localhost:9000 (`changeme@example.com` / `MyPassword`); add
a few recipes there first. The script is safe to re-run and fetches a new Mealie
token if the old one stops working. Stop the containers with
`docker compose -f docker-compose.dev.yml stop`, or wipe them with `down -v`.
It also creates empty `planner_test` and `planner_e2e` databases for the commands below.

```sh
cd app
bun install
bun run dev                                       # needs DATABASE_URL, AUTH_SECRET, MEALIE_URL, MEALIE_API_TOKEN (+ MEALIE_PUBLIC_URL for links)
bun run format:check && bun run lint && bun run typecheck && bun run test
bun run format && bun run lint:fix                # fix formatting and auto-fixable lint
bun run update-packages --dry-run                 # outdated deps; without --dry-run applies minor/patch
DATABASE_TEST_URL=postgres://... bun run test:db  # throwaway database
# End-to-end smoke test against a running build (empties DATABASE_URL!):
E2E_ALLOW_RESET=1 E2E_BASE_URL=http://localhost:3000 DATABASE_URL=postgres://... \
  MEALIE_TEST_URL=http://localhost:9000 bun run test:e2e
MEALIE_TEST_URL=http://localhost:9000 DATABASE_TEST_URL=postgres://... bun run test:integration
```

[Bun](https://bun.sh) installs the packages and runs the scripts; the app, the tests and the
production image still run on Node 26. Always use `bun run <script>`: `bun test` and `bun build`
are Bun's own test runner and bundler, not this project's scripts.

Formatting is [oxfmt](https://oxc.rs/docs/guide/usage/formatter) (`app/.oxfmtrc.json`: 80 columns,
sorted imports, sorted Tailwind classes) and linting is
[oxlint](https://oxc.rs/docs/guide/usage/linter) (`app/.oxlintrc.json`), plus one house rule:

- braces on every `if`/`else`/loop body, even one-liners (`curly: all`).

`.vscode/` sets the oxc extension (`oxc.oxc-vscode`) as formatter, with format on save.

CI runs all of the above, scans for committed secrets with gitleaks, builds
and smoke-tests the image, and pushes it to GHCR from `main` and `v*` tags.

### Moving or forking the repository

Nothing in the repo is tied to one GitHub account. CI publishes the image to
`ghcr.io/<owner>/<repo>` using the built-in `GITHUB_TOKEN`; no secrets need
to be configured. After transferring the repo to another user or organisation:

1. In the new owner's settings, allow GitHub Actions to run and set workflow
   permissions to allow the `packages: write` the image job requests
   (organisations can restrict this; *Settings → Actions → General*).
2. Push to `main` once so CI publishes `ghcr.io/<new-owner>/scrappy-meals`.
   Make the package public (or log the server in to GHCR) under the
   package's settings. Images under the old owner stay where they were.
3. On the server, set `APP_IMAGE=ghcr.io/<new-owner>/scrappy-meals` in `.env`
   and `docker compose pull app && docker compose up -d app`.
4. Third-party apps (e.g. a secret scanner) are installed per account and
   need installing again under the new owner if you want them.

## License

[AGPL-3.0-or-later](LICENSE). You can use, modify and self-host it freely;
if you run a modified version as a service for others, you must offer them
its source.

Security issues: see [SECURITY.md](SECURITY.md).
