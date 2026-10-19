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
| `app/` | Next.js app (from milestone M2) |

Only Caddy publishes ports. Postgres and Mealie are reachable only on the
Compose network; the app calls Mealie at `http://mealie:9000` with a
server-side API token.

## Deploying (Hetzner VPS, ~4 GB)

1. Point DNS `A`/`AAAA` records for `app.<domain>` and `recipes.<domain>` at the VPS.
2. Install Docker, then clone this repo to `/opt/scrappy-meals`.
3. `cp .env.example .env && chmod 600 .env`, fill in the domain and the
   Postgres passwords (`openssl rand -base64 32`).
4. `docker compose up -d postgres mealie caddy`.
5. Open `https://recipes.<domain>`, log in as `changeme@example.com` /
   `MyPassword`, **change that account's email and password immediately**,
   then create an API token (Profile → API Tokens) and put it in
   `MEALIE_API_TOKEN`.
6. Set up backups: follow `docs/aws-backup-setup.md`, run
   `scripts/backup.sh` once by hand, then install the cron entry.
7. Once the app image exists (M2): `docker compose up -d`.

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
