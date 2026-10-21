# Development

You need Docker, Node.js 26 and [Bun](https://bun.sh). Bun installs the packages and runs the
scripts; the app and the tests run on Node.

## Running it locally

```sh
scripts/dev-up.sh     # starts Postgres and Mealie, writes app/.env.local, migrates, asks for your first login
cd app && bun run dev # http://localhost:3000
```

`scripts/dev-up.sh` uses `docker-compose.dev.yml`, which publishes Postgres and Mealie on
localhost only. It is safe to re-run, and fetches a new Mealie token if the old one stops working.
It also creates empty `planner_test` and `planner_e2e` databases for the tests.

- Mealie: http://localhost:9000 (`changeme@example.com` / `MyPassword`). Add a few recipes there.
- Another login: `cd app && set -a; . ./.env.local; set +a; bun run cli user add`
- Stop the containers: `docker compose -f docker-compose.dev.yml stop`
- Start over: `docker compose -f docker-compose.dev.yml down -v`

## Repo layout

| Path | What |
| --- | --- |
| `app/` | The Next.js app. The Mealie client is in `app/src/server/mealie/` |
| `docker-compose.yml` | Production: Postgres, Mealie, the app, Caddy, plus `backup` / `restore` |
| `docker-compose.dev.yml` | Local Postgres and Mealie for development |
| `Caddyfile` | `app.<domain>` → app, `recipes.<domain>` → Mealie, automatic HTTPS |
| `postgres/init/` | Creates the `planner` and `mealie` databases on first boot |
| `backup/`, `scripts/` | Backup image, `backup.sh`, `restore.sh`, `dev-up.sh` |
| `docs/` | Everything else; start at [docs/README.md](README.md) |
| `AGENTS.md`, `.agents/`, `.claude/` | Instructions and skills for AI coding agents |

## Checks and tests

Run these from `app/`. Always `bun run <script>`: `bun test` and `bun build` are Bun's own tools,
not this project's scripts.

```sh
bun run format:check && bun run lint && bun run typecheck && bun run test
bun run format && bun run lint:fix                # fix formatting and what lint can fix
```

Tests that need a database or a real Mealie (the local ones from `dev-up.sh` work):

```sh
DATABASE_TEST_URL=postgres://... bun run test:db
MEALIE_TEST_URL=http://localhost:9000 DATABASE_TEST_URL=postgres://... bun run test:integration
```

The end-to-end tests run against a running build and **empty `DATABASE_URL`**, so point them
at `planner_e2e`:

```sh
E2E_ALLOW_RESET=1 E2E_BASE_URL=http://localhost:3000 DATABASE_URL=postgres://... \
  MEALIE_TEST_URL=http://localhost:9000 bun run test:e2e
```

## Formatting and linting

[oxfmt](https://oxc.rs/docs/guide/usage/formatter) (`app/.oxfmtrc.json`) and
[oxlint](https://oxc.rs/docs/guide/usage/linter) (`app/.oxlintrc.json`). One house rule on top:
braces on every `if`/`else`/loop body, even one-liners. `.vscode/` sets up the oxc extension to
format on save.

## Updating packages

```sh
bun run update-packages --dry-run   # list what's outdated
bun run update-packages             # apply minor and patch updates
```

Major upgrades are listed but not applied; do each one in its own PR.

## CI

CI runs all the checks and tests above, scans for committed secrets with gitleaks, builds and
smoke-tests the image, and publishes it to GHCR from `main` and from `v*` tags. How a commit
gets to the server: [docs/README.md](README.md#from-a-commit-to-the-server).

## Forking or moving the repo

Nothing is tied to one GitHub account. CI publishes to `ghcr.io/<owner>/<repo>` with the built-in
`GITHUB_TOKEN`, so there are no secrets to set up. Under the new owner:

1. Allow GitHub Actions to run, with workflow permissions that allow `packages: write`
   (*Settings → Actions → General*; organisations can restrict this).
2. Push to `main` once so CI publishes `ghcr.io/<new-owner>/scrappy-meals`. Make the package
   public, or log the server in to GHCR.
3. On the server, set `APP_IMAGE=ghcr.io/<new-owner>/scrappy-meals` in `.env`, then
   `docker compose pull app && docker compose up -d app`.
4. Reinstall any third-party GitHub apps (e.g. a secret scanner) you want under the new owner.
