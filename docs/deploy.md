# Deploying on a VPS

A start-to-finish guide for one small server (tested target: Hetzner, 4 GB
RAM, Ubuntu 24.04). The app image is built for x86-64 (amd64) only, so pick an
Intel/AMD server, not an ARM one (e.g. not Hetzner's CAX line). Everything runs from `docker-compose.yml`: Postgres,
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
container. To see what is actually using the memory over time, set up
monitoring (section 8).

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
| `example.com` | redirects to `app.example.com` |
| `www.example.com` | the same (an `A`/`AAAA` record, or a `CNAME` to `example.com`) |

Caddy requests the certificates on first start, so DNS must resolve first.
That includes the bare domain and `www`: Caddy asks for a certificate for
every name in the Caddyfile, and keeps retrying (and logging errors) for one
that doesn't point at the server.

## 3. Configuration

```sh
sudo mkdir -p /opt/scrappy-meals && sudo chown deploy: /opt/scrappy-meals
git clone https://github.com/<owner>/scrappy-meals.git /opt/scrappy-meals
cd /opt/scrappy-meals
cp .env.example .env && chmod 600 .env
```

Fill in `.env`. Generate each secret with `openssl rand -hex 32` (hex, because
the database passwords end up inside a `postgres://` URL):

- `DOMAIN`, `ACME_EMAIL`, `TZ` (your home time zone: "today" follows each
  device's own zone, and `TZ` stands in until a device has sent it; it also
  stamps the backups)
- `POSTGRES_SUPERUSER_PASSWORD`, `PLANNER_DB_PASSWORD`, `MEALIE_DB_PASSWORD`
- `AUTH_SECRET`
- `OFF_USER_ID`, `OFF_PASSWORD` (optional: leave empty unless you set up
  contributing to Open Food Facts, section 5)
- `ANTHROPIC_API_KEY` (optional: estimating missing nutrition, section 5)
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

Mealie starts with a well-known admin login (`changeme@example.com` /
`MyPassword`). Bots find new HTTPS hosts within minutes of their certificate
being issued, so set Mealie up **before** Caddy publishes it:

```sh
docker compose up -d postgres mealie
docker compose logs -f mealie   # wait for "Application startup complete"
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \
  "$(docker compose ps -q mealie)"   # Mealie's address on the Docker network
```

From your own machine, tunnel to it and open `http://localhost:9000`:

```sh
ssh -L 9000:<that address>:9000 deploy@<server>
```

1. Sign in as `changeme@example.com` / `MyPassword` and **change that
   account's email and password** (Profile → Edit).
2. Create a second, non-admin user for the planner (Admin → Users, in the same
   household). Sign in as it and create an API token (Profile → API Tokens).
   Put the token in `MEALIE_API_TOKEN` in `.env`. The planner reads and
   imports recipes (creating the foods and units they need); if the token
   leaks it can't manage users or Mealie's settings.
3. Add or import a few recipes.
4. Optional, for importing Instagram and Facebook posts: as the admin, add an
   AI provider (Group Settings → AI Providers), test it, then pick it as the
   group's **default** and **image** provider. Leave **audio** empty: the
   planner sends the post's caption and screenshots, never the video. For
   Claude, which Mealie reaches through Anthropic's OpenAI-compatible API:

   | Field | Value |
   |---|---|
   | Base URL | `https://api.anthropic.com/v1/` |
   | API key | a Claude API key (console.anthropic.com → API keys) |
   | Model | `claude-sonnet-5-5` |

   Add the header `anthropic-workspace-id` if the key can reach several
   workspaces. The key lives in Mealie's database, so it's in the (encrypted)
   backups too; it never goes into `.env`. The planner's token stays a plain
   member's: it reads whether AI is set up from the group, not from the
   manage-only settings. Without a provider, everything else works and post
   imports say that AI isn't set up. What Mealie does with the provider is in
   [mealie-api.md](mealie-api.md#importing-with-ai).

Then publish it: `docker compose up -d caddy`.

**Who needs a Mealie account.** Only people who add or edit recipes. Everyone
signed in to the planner can read a planned meal's recipe there (ingredients,
method, notes) without one. Mealie stays public at `recipes.<domain>`, behind
its own login, with sign-up off (`ALLOW_SIGNUP=false`). To add an editor, as
the admin either:
- create them under Admin → Users → Create User, in the same household as the
  planner's Mealie user, or
- send an invite link from the household's settings (Members → Invite). It
  works with sign-up off and puts them in that household.

The planner's recipe page links to Mealie ("Edit in Mealie") at
`MEALIE_PUBLIC_URL`; the link only works for people with an account.

Recipes work best in the planner when they have:
- a **servings** count (needed to scale the shopping list),
- **nutrition** filled in (per serving),
- **parsed ingredients** (Mealie's ingredient parser), so lines merge on the
  shopping list. Unparsed lines still appear, as written.

## 5. The planner

Set up monitoring first (section 8, "Monitoring"): its agent needs a key from
the hub, and without it the next command fails.

```sh
docker compose up -d
docker compose exec app scrappy user add      # once per person
```

Open `https://app.example.com`, sign in, and set your targets and default
fasting days under **Settings**. How many snacks a day the plan has (2 unless
you change it) is set there too, once for the whole household.

**Install it on your phone:** open the site in Safari (iOS: Share → Add to
Home Screen) or Chrome (Android: Install, or menu → Install app); Settings
shows the steps for the device it's on. This week's plan, meal pages and
shopping list, and weeks you've opened, stay readable offline; shopping-list
ticks wait for a connection, other changes need one. After a release, an open
app offers a reload into the new version.

**Scanning barcodes** (Add snack → Product → Scan) uses the phone's camera, so
the first use asks for permission (on an iPhone's Home Screen app it may ask
again each launch). Caddy sends `Permissions-Policy: camera=(self),
microphone=(), geolocation=()` on `app.` only, so nothing embedded can reach
the camera; Mealie's site is untouched. The reader's wasm is served by the app
itself from `/zxing/` (copied from the `zxing-wasm` package by
`scripts/copy-wasm.mjs` during `bun run build`, which fails if it can't), so no
scanner request leaves for a CDN. Changing the
Caddyfile needs `docker compose restart caddy`.

### Contributing products to Open Food Facts (optional)

The product sheet can send a scanned product back to
[Open Food Facts](https://world.openfoodfacts.org) when it lacks the product or
some of its fields (name, pack and serving size, per-100 g nutrition). It is off
until both variables are set; the checkbox on the sheet only appears then.

1. Create a **dedicated** Open Food Facts account for the planner (its
   username, not an email address), not a personal one: the password sits in
   `.env`.
2. Fill in Open Food Facts' API usage form for apps (linked from their
   [API documentation](https://openfoodfacts.github.io/openfoodfacts-server/api/)),
   naming the planner.
3. Put the username in `OFF_USER_ID` and the password in `OFF_PASSWORD`, then
   `docker compose up -d`. Single-quote a password containing `$` in `.env`
   (`OFF_PASSWORD='pa$$word'`), or Compose reads it as a variable.

What goes out: the barcode, name, pack and serving size (only when they came
from the pack or were typed, not a guess) and the per-100 g nutrition, and only
fields Open Food Facts has empty; nothing is overwritten. Nutrition is added
only to a record with none, or per 100 g to one that is already per 100 g.
Each person gets a stable anonymous id (derived from `AUTH_SECRET`), so Open
Food Facts can block one person without blocking the app. Nothing about who ate
what is sent. A product is sent once; one that failed shows "Not sent to Open
Food Facts yet" with a Retry button on its recipe page.

### Estimating missing nutrition (optional)

With `ANTHROPIC_API_KEY` set, the planner asks Claude for per-serving
nutrition when an imported recipe's page gives none, and the review page gets
an "Estimate from ingredients" button. Create a key at
[console.anthropic.com](https://console.anthropic.com) (a separate key from the
one Mealie's AI provider uses makes the spend easy to tell apart), put it in
`.env` and `docker compose up -d`. Without it, missing nutrition stays missing
until someone fills it in.

What goes out: the recipe's name, servings and ingredient lines, nothing about
who plans or eats it. One estimate is one request to `claude-opus-5-5`, a
fraction of a cent; the review button allows 30 an hour per person.

## 6. Backups

Follow [aws-backup-setup.md](aws-backup-setup.md) to create the bucket, the
write-only key and the age key, add the values to `.env`, then:

```sh
scripts/backup.sh                               # run once by hand, check the bucket
echo '15 3 * * * deploy /opt/scrappy-meals/scripts/backup.sh >> /var/log/scrappy-meals-backup.log 2>&1' \
  | sudo tee /etc/cron.d/scrappy-meals
sudo touch /var/log/scrappy-meals-backup.log && sudo chown deploy /var/log/scrappy-meals-backup.log
```

**Get told when a night fails.** Nobody reads that log. Create a check on
healthchecks.io (daily, 1 h grace) and put its ping URL in `BACKUP_PING_URL`:
you get an email when a backup fails or doesn't run.

The first backup of each month is also kept as the monthly copy (for a
year). If the backup on the 1st fails, run `scripts/backup.sh` by hand that
day so the month still gets one.

Do a test restore on a throwaway server once, so you know it works before
you need it.

## 7. Releasing and updating

Merging to `main` does **not** change what the server runs. CI publishes images
only for release tags:

| Event | Tags | Used by |
| --- | --- | --- |
| Pull request | none (built and smoke-tested only when the PR touches the image) | |
| Push to `main` | none (always built and smoke-tested) | |
| Tag `vX.Y.Z` | `:X.Y.Z`, `:X.Y`, `:latest` | the server |
| Tag `vX.Y.Z-rc.N` | `:X.Y.Z-rc.N` | trying a build before releasing it |

**To release**, tag a commit on `main` that has green CI, then push the tag (or
publish a GitHub release, which creates the tag):

```sh
git tag v0.2.0 && git push origin v0.2.0
```

Wait for the CI run on the tag to finish (it runs the full test suite again
and then publishes). **Then update the server:**

```sh
cd /opt/scrappy-meals
git fetch --tags && git checkout v0.2.0   # compose file, Caddyfile, scripts of that release
docker compose pull                       # app and any other image the release bumped
docker compose --profile ops build        # backup/restore image, if backup/ changed
docker compose up -d --wait               # recreates what changed, waits until healthy
docker compose restart caddy              # only if the Caddyfile changed
```

`--wait` fails if a container doesn't come up healthy (e.g. a migration
failed): check `docker compose logs app`. The Caddyfile is mounted as a single
file, so a running Caddy keeps reading the old one after `git checkout` until
it is restarted.

`APP_TAG` in `.env` decides which image that pulls:

- `APP_TAG=0.2.0`: pinned (recommended). Upgrading means changing it on
  purpose; rolling back means setting the previous version.
- `APP_TAG=latest`: always the newest release, never an unreleased `main`.
- `APP_TAG=0.3.0-rc.1`: a prerelease, only for trying a build. `latest` never
  points at one.

The app applies database migrations itself on start. Migrations only move
forward, so rolling back past a release that added one needs the backup from
before the upgrade (section 6, `scripts/restore.sh`). Take a backup before
upgrading across a migration.

**Upgrading Mealie** is a code change, not just a pull: the planner's Mealie
client is generated from a specific Mealie version. Bump the tag in
`docker-compose.yml` and `docker-compose.dev.yml` in the repo, regenerate the client
(`docs/mealie-api.md` → Upgrading Mealie), let CI pass, then deploy. The
health check reports `"versionMatches": false` if they drift.

**Upgrading Postgres** to a new major version (18 → 19) is a dump and restore:
a new major can't read the old one's data. Each major keeps its data in its own
directory of the `pgdata` volume (`/var/lib/postgresql/18/docker`), so the new
version starts on an empty cluster next to the old one, and the old one stays
untouched for a rollback. Bump the image in `docker-compose.yml`,
`backup/Dockerfile` (`pg_dump` must match the server) and the three places in
`.github/workflows/ci.yml` together, release, then on the server:

```sh
cd /opt/scrappy-meals
# 1. On the release still running: stop writes, back up with the old pg_dump.
docker compose stop app mealie
scripts/backup.sh
# 2. Switch to the new release; Postgres comes up empty and postgres/init
#    creates the roles and databases again.
git fetch --tags && git checkout v0.5.0
docker compose --profile ops build
docker compose up -d --wait postgres
# 3. Restore the backup from step 1 (it prints which one; check the time).
RESTORE_AWS_ACCESS_KEY_ID=... RESTORE_AWS_SECRET_ACCESS_KEY=... \
  AGE_IDENTITY_FILE=/path/to/age-identity.txt scripts/restore.sh daily latest
docker compose pull && docker compose up -d --wait
```

To roll back, check out the previous release and `docker compose up -d --wait`:
the old version finds its data where it left it, as of step 1. Once the new
version has run for a while, free the space:
`docker compose exec postgres rm -rf /var/lib/postgresql/18`.

## 8. Checking on it

```sh
docker compose ps                         # all "healthy" / "running"
curl -s https://app.example.com/api/health
docker compose logs --since 1h app mealie
```

Pointing an uptime monitor (e.g. healthchecks.io, Uptime Kuma) at
`/api/health` catches outages; it returns 503 when the database is down.

### Monitoring

[Beszel](https://beszel.dev) keeps a history of CPU, memory, swap, disk and
network, for the server and for each container, and can alert on them (e.g.
memory above 90%, disk nearly full). It answers "what is using the memory"
better than Hetzner's graphs, which can't see inside the VM. It's two services:
`beszel` (the hub: dashboard and history) and `beszel-agent` (collects the
numbers). Idle, they use about 15 MB together; their limits are 128 MB and
64 MB.

The agent exits until it has the hub's key. On a new server, or one set up
before monitoring existed, do the steps below before the next
`docker compose up -d --wait`, which otherwise fails on the agent.

The dashboard is never published: it listens on the server's loopback only.
The agent mounts the Docker socket to read container stats, which is
root-equivalent access to the server, so keep the image pinned and the
dashboard behind the tunnel.

```sh
cd /opt/scrappy-meals
docker compose up -d beszel                # the hub only, for now
```

From your own machine, tunnel to it and open `http://localhost:8090`:

```sh
ssh -L 8090:localhost:8090 deploy@<server>
```

1. Create the admin account (the first visit asks for it).
2. **Add System**: any name, and as the host `/beszel_socket/beszel.sock`
   (the agent talks to the hub over a socket, not a port). Copy the **Key** and
   **Token** it shows into `BESZEL_AGENT_KEY` and `BESZEL_AGENT_TOKEN` in
   `.env`.
3. `docker compose up -d --wait`. The system turns green within a minute.
4. Optional: alerts under the system's bell icon, notifications (email, ntfy,
   …) under Settings.

The history lives in the `beszel-data` volume. It isn't backed up: losing it
loses only past graphs.

## 9. Rebuilding from scratch

When the server is lost, or to practise a restore:

1. Sections 1–3 on a new server. Take `.env` from your password manager (keep
   a copy there next to the age identity) instead of writing a new one.
2. `docker compose up -d postgres`, then restore the latest backup:
   [aws-backup-setup.md](aws-backup-setup.md) §6.
3. `docker compose up -d --wait`. Mealie's own secrets come back with its data
   volume, so the existing `MEALIE_API_TOKEN` keeps working, and the users and
   their passwords come back with the planner database.

## Users

There is no sign-up page and no default account. Create accounts on the server with
`docker compose exec app scrappy ...`:

| Command | |
|---|---|
| `scrappy user add [--name N] [--email E]` | create a user |
| `scrappy user passwd EMAIL` | set a new password; signs out that user's sessions |
| `scrappy user list` | list users |
| `scrappy user remove EMAIL` | delete a user and their portions/adherence |

Passwords are read from a hidden prompt (or stdin when piped) and stored as argon2id hashes;
they never go into env vars, files or logs. Failed logins are rate-limited per email and per IP.
