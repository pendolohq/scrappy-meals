# Deploying on a VPS

A start-to-finish guide for one small server (tested target: Hetzner, 4 GB
RAM, Ubuntu 24.04). Everything runs from `docker-compose.yml`: Postgres,
Mealie, the app and Caddy (HTTPS). Only ports 80 and 443 are exposed.

Throughout, replace `example.com` with your domain and `<owner>` with the
GitHub user or organisation that hosts the repo (lowercase).

## 1. Server

```sh
# As root on a fresh server
adduser deploy && usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # reuse your SSH key

# Firewall: SSH, HTTP, HTTPS only. Note that ports Docker publishes bypass ufw;
# that's fine here because Caddy (80/443) is the only service publishing any.
ufw allow OpenSSH && ufw allow 80,443/tcp && ufw allow 443/udp && ufw enable

# Docker (official convenience script)
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

Optional but recommended on 4 GB: a 2 GB swap file, so a memory spike (e.g.
Mealie importing a big recipe) slows things down instead of killing a
container.

```sh
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 2. DNS

Create `A` (and `AAAA` if you have IPv6) records pointing at the server:

| Name | Purpose |
|---|---|
| `app.example.com` | the planner |
| `recipes.example.com` | Mealie |

Caddy requests the certificates on first start, so DNS must resolve first.

## 3. Configuration

```sh
sudo mkdir -p /opt/scrappy-meals && sudo chown deploy: /opt/scrappy-meals
git clone https://github.com/<owner>/scrappy-meals.git /opt/scrappy-meals
cd /opt/scrappy-meals
cp .env.example .env && chmod 600 .env
```

Fill in `.env`. Generate each secret with `openssl rand -hex 32` (hex, because
the database passwords end up inside a `postgres://` URL):

- `DOMAIN`, `ACME_EMAIL`, `TZ` (your time zone decides what "today" is)
- `POSTGRES_SUPERUSER_PASSWORD`, `PLANNER_DB_PASSWORD`, `MEALIE_DB_PASSWORD`
- `AUTH_SECRET`
- `APP_IMAGE=ghcr.io/<owner>/scrappy-meals`, `APP_TAG=<version>` (see section 7) or `latest`

Leave `MEALIE_API_TOKEN` empty for now. Keep comments on their own lines:
Compose reads `KEY=   # note` as the value `# note`. Check what Compose
actually sees with:

```sh
docker compose config | grep -E 'S3_ENDPOINT|BACKUP_PING_URL|MEALIE_API_TOKEN'
```

If the GHCR package is private, log the server in once with a GitHub token
that has `read:packages`: `docker login ghcr.io -u <github-user>`.

## 4. Mealie first

```sh
docker compose up -d postgres mealie caddy
docker compose logs -f mealie   # wait for "Application startup complete"
```

Open `https://recipes.example.com` and sign in as `changeme@example.com` /
`MyPassword`. **Immediately** change that account's email and password
(Profile → Edit). Then create an API token (Profile → API Tokens), put it in
`MEALIE_API_TOKEN` in `.env`, and add or import a few recipes.

Recipes work best in the planner when they have:
- a **servings** count (needed to scale the shopping list),
- **nutrition** filled in (per serving),
- **parsed ingredients** (Mealie's ingredient parser), so lines merge on the
  shopping list. Unparsed lines still appear, as written.

## 5. The planner

```sh
docker compose up -d
docker compose exec app scrappy user add      # once per person
```

Open `https://app.example.com`, sign in, and set your targets and default
fasting days under **Settings**.

**Install it on your phone:** open the site in Safari (iOS: Share → Add to
Home Screen) or Chrome (Android: menu → Install app). Weeks you've opened stay
readable offline; changes need a connection.

## 6. Backups

Follow [aws-backup-setup.md](aws-backup-setup.md) to create the bucket, the
write-only key and the age key, add the values to `.env`, then:

```sh
scripts/backup.sh                               # run once by hand, check the bucket
echo '15 3 * * * deploy /opt/scrappy-meals/scripts/backup.sh >> /var/log/scrappy-meals-backup.log 2>&1' \
  | sudo tee /etc/cron.d/scrappy-meals
sudo touch /var/log/scrappy-meals-backup.log && sudo chown deploy /var/log/scrappy-meals-backup.log
```

Do a test restore on a throwaway server once, so you know it works before
you need it.

## 7. Releasing and updating

Merging to `main` does **not** change what the server runs. CI publishes these
image tags:

| Event | Tags | Used by |
| --- | --- | --- |
| Pull request | none (built and smoke-tested only when the PR touches the image) | |
| Push to `main` | `:main`, `:sha-<commit>` | trying a build before releasing it |
| Tag `vX.Y.Z` | `:X.Y.Z`, `:X.Y`, `:latest` | the server |

**To release**, tag a commit on `main` that has green CI, then push the tag (or
publish a GitHub release, which creates the tag):

```sh
git tag v0.2.0 && git push origin v0.2.0
```

Wait for the CI run on the tag to finish (it runs the full test suite again
and then publishes). **Then update the server:**

```sh
cd /opt/scrappy-meals
git checkout v0.2.0               # compose file, Caddyfile, scripts of that release
docker compose pull app && docker compose up -d app
```

`APP_TAG` in `.env` decides which image that pulls:

- `APP_TAG=0.2.0`: pinned (recommended). Upgrading means changing it on
  purpose; rolling back means setting the previous version.
- `APP_TAG=latest`: always the newest release, never an unreleased `main`.
- `APP_TAG=sha-<commit>` or `main`: only for trying a build.

The app applies database migrations itself on start. Migrations only move
forward, so rolling back past a release that added one needs the backup from
before the upgrade (section 6, `scripts/restore.sh`). Take a backup before
upgrading across a migration.

**Upgrading Mealie** is a code change, not just a pull: the planner's Mealie
client is generated from a specific Mealie version. Bump the tag in
`docker-compose.yml` in the repo, regenerate the client
(`docs/mealie-api.md` → Upgrading Mealie), let CI pass, then deploy. The
health check reports `"versionMatches": false` if they drift.

## 8. Checking on it

```sh
docker compose ps                         # all "healthy" / "running"
curl -s https://app.example.com/api/health
docker compose logs --since 1h app mealie
```

Pointing an uptime monitor (e.g. healthchecks.io, Uptime Kuma) at
`/api/health` catches outages; it returns 503 when the database is down.

## Users

| Command | |
|---|---|
| `docker compose exec app scrappy user add` | create a user |
| `docker compose exec app scrappy user passwd EMAIL` | new password; signs them out everywhere |
| `docker compose exec app scrappy user list` | list users |
| `docker compose exec app scrappy user remove EMAIL` | delete a user and their portions/logs |
