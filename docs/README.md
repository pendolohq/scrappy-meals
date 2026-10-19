# Docs

How scrappy-meals is put together, shipped and run. The repo [README](../README.md) covers
features and local development; these pages cover everything else.

| Page | Read it when you… |
| --- | --- |
| [deploy.md](deploy.md) | set up the server, release a version, update or roll back the running app |
| [security.md](security.md) | add or change a page, server action, route handler, or anything about sign-in |
| [mealie-api.md](mealie-api.md) | touch the Mealie client, nutrition, shopping lists, or upgrade Mealie |
| [aws-backup-setup.md](aws-backup-setup.md) | set up the S3 bucket and keys for backups, or restore from one |

## How the pieces fit

One VPS runs everything with Docker Compose (`docker-compose.yml`):

```
            internet
               │  :80 / :443
           ┌───┴───┐
           │ Caddy │  automatic HTTPS
           └─┬───┬─┘
 app.<domain>│   │recipes.<domain>
      ┌──────┴┐ ┌┴───────┐
      │  app  │→│ Mealie │  REST API, server-side token
      └───┬───┘ └───┬────┘
          │         │
      ┌───┴─────────┴───┐
      │   Postgres 16   │  databases `planner` and `mealie`, one role each
      └─────────────────┘
```

- **Only Caddy publishes ports.** Postgres and Mealie are reachable only on the Compose network.
- **The app (`app/`, Next.js)** stores the plan, portions, fasting days, adherence and users in
  the `planner` database. It reads recipes and nutrition from Mealie and writes shopping lists
  to it, always through Mealie's API, never its database.
- **Users** are created on the server with the `scrappy` CLI inside the app container. There is
  no sign-up page.
- **Backups:** `scripts/backup.sh` (cron) runs the `backup` service, which dumps both databases
  and Mealie's files, encrypts them with age and uploads them to S3. `scripts/restore.sh` reverses
  it.

## From a commit to the server

1. **Pull request:** CI (`.github/workflows/ci.yml`) runs format, lint, typecheck, unit/db/
   integration tests, the e2e smoke test and a secret scan. PRs that touch what goes into the image
   also build and smoke-test it. Nothing is published.
2. **Merge to `main`:** the same checks, then the image is published as
   `ghcr.io/<owner>/scrappy-meals:main` and `:sha-<commit>`. The server doesn't pick these up.
3. **Release:** tagging `vX.Y.Z` runs CI again and publishes `:X.Y.Z`, `:X.Y` and `:latest`.
4. **Deploy:** on the server, `git checkout vX.Y.Z` and
   `docker compose pull app && docker compose up -d app`. `APP_TAG` in `.env` picks the image
   (pinned version recommended). The app runs database migrations itself on start.

Details, rollback and the first-time setup are in [deploy.md](deploy.md) (sections 7 and 1–6).
