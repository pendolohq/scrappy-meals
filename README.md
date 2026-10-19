# scrappy-meals

Self-hosted meal planner for two, built on [Mealie](https://mealie.io).
Mealie stores recipes, nutrition and shopping lists; the planner (Next.js)
handles the shared weekly plan, per-person portions, fasting days and
adherence, and talks to Mealie only through its REST API.

## Layout

| Path | What |
|---|---|
| `docker-compose.yml` | Postgres 16, Mealie, the app, Caddy, plus on-demand `backup` / `restore` services |
| `Caddyfile` | `app.<domain>` → app, `recipes.<domain>` → Mealie, automatic HTTPS |
| `postgres/init/` | First-boot script: separate role + database for `planner` and `mealie` |
| `backup/` | Image and script for encrypted nightly backups to S3 |
| `scripts/` | Host-side `backup.sh` (cron) and `restore.sh` |
| `docs/aws-backup-setup.md` | One-time S3 bucket, lifecycle and IAM setup |
| `app/` | Next.js app; Mealie client in `app/src/server/mealie/` |
| `docs/mealie-api.md` | What we rely on in the Mealie API, incl. nutrition semantics |

Only Caddy publishes ports. Postgres and Mealie are reachable only on the
Compose network; the app calls Mealie at `http://mealie:9000` with a
server-side API token.

## Deploying (Hetzner VPS, ~4 GB)

1. Point DNS `A`/`AAAA` records for `app.<domain>` and `recipes.<domain>` at the VPS.
2. Install Docker, then clone this repo to `/opt/scrappy-meals`.
3. `cp .env.example .env && chmod 600 .env`, fill in the domain and the
   secrets (`openssl rand -hex 32` for each).
4. `docker compose up -d postgres mealie caddy`.
5. Open `https://recipes.<domain>`, log in as `changeme@example.com` /
   `MyPassword`, **change that account's email and password immediately**,
   then create an API token (Profile → API Tokens) and put it in
   `MEALIE_API_TOKEN`.
6. Set up backups: follow `docs/aws-backup-setup.md`, run
   `scripts/backup.sh` once by hand, then install the cron entry.
7. Start everything: `docker compose up -d`. Migrations run automatically
   on each app start.
8. Create the accounts (repeat per person):
   ```sh
   docker compose exec app scrappy user add
   ```
   You'll be asked for a name, email and password (hidden, min. 12 chars).

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
never go into env vars, files or logs. Logins are rate-limited per email and
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

```sh
cd app
pnpm install
pnpm dev                 # needs DATABASE_URL, AUTH_SECRET, MEALIE_URL, MEALIE_API_TOKEN (+ MEALIE_PUBLIC_URL for links)
pnpm lint && pnpm typecheck && pnpm test
DATABASE_TEST_URL=postgres://... pnpm test:db       # throwaway database
MEALIE_TEST_URL=http://localhost:9000 DATABASE_TEST_URL=postgres://... pnpm test:integration
```

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
