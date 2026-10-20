# scrappy-meals

A meal planner for one household that you host yourself. Recipes live in
[Mealie](https://mealie.io); scrappy-meals adds a shared weekly plan on top.

- Plan the week together, with a column per person and daily calories,
  protein, carbs, fat and fibre against each person's own targets.
- Set how much each person eats of every meal, and mark fasting days.
- Add recipes by pasting a link, or a caption or screenshots from Instagram
  or Facebook.
- Open any planned meal to cook from it, scaled to how many you're cooking for.
- Turn the week into a shopping list, then tick it off in the shop, offline
  too.
- Install it on your phone like an app.

## What you need

To try it on your own computer:

- [Docker](https://docs.docker.com/get-docker/)
- [Node.js](https://nodejs.org) 26
- [Bun](https://bun.sh)

To host it for real:

- A small Linux server (4 GB RAM, Intel/AMD, not ARM)
- A domain name you can add DNS records to
- An S3 bucket for backups (optional, but strongly recommended)

## Run it on your computer

```sh
git clone https://github.com/pendolohq/scrappy-meals.git
cd scrappy-meals
scripts/dev-up.sh       # starts Postgres and Mealie, asks you to create a login
cd app && bun run dev
```

Open http://localhost:3000 and sign in. Mealie is at http://localhost:9000
(`changeme@example.com` / `MyPassword`): add a few recipes there first.

Tests, tools and everything else for working on the code:
**[docs/development.md](docs/development.md)**.

## Host it yourself

Everything runs from one `docker-compose.yml`: Postgres, Mealie, the app, and
Caddy for HTTPS. The full walkthrough, from a fresh server to signing in, is
in **[docs/deploy.md](docs/deploy.md)**.

## Backups

Each night the server encrypts both databases and Mealie's files and uploads
them to S3. The server can add backups but can't read or delete them. Setup and
restoring: **[docs/aws-backup-setup.md](docs/aws-backup-setup.md)**.

## More docs

[docs/README.md](docs/README.md) explains how the pieces fit together and
lists the rest of the docs.

## License

[AGPL-3.0-or-later](LICENSE). You can use, modify and self-host it freely;
if you run a modified version as a service for others, you must offer them
its source.

Security issues: see [SECURITY.md](SECURITY.md).
