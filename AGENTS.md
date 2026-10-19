# Agent setup

scrappy-meals is a self-hosted meal planner for one household, built on Mealie. The Next.js app
lives in `app/`; the rest of the repo is how it's deployed (Compose, Caddy, Postgres init,
backups). Start with [docs/README.md](docs/README.md) for how the pieces fit.

## Next.js

The app runs Next.js 16. Its APIs and conventions may differ from your training data: read the
relevant guide in `app/node_modules/next/dist/docs/` before writing Next.js code, and heed
deprecation notices. `app/AGENTS.md` holds the block `next dev` maintains; leave it to Next.js.

## Runbooks: read these *when the task calls for it*, not upfront

This file holds only what is always in force. Anything with rules that are easy to break silently
lives in a doc; the trigger for reading each one is below.

| Read before… | Doc |
| --- | --- |
| Adding or changing a page, layout, server action, route handler, or anything about sign-in | `docs/security.md` |
| Touching the Mealie client, nutrition, shopping lists, or upgrading Mealie | `docs/mealie-api.md` |
| Changing CI, the Dockerfile, Compose, Caddy, releases or anything on the server | `docs/deploy.md` |
| Changing backups or restores | `docs/aws-backup-setup.md`, `scripts/backup.sh`, `scripts/restore.sh` |

## Package management

- Use `pnpm`, from `app/`. Don't use `npm` or `yarn` to add or update packages unless asked.
- Pin new dependencies to the latest version at the time: `pnpm add -E <pkg>@latest`
  (`-D` for dev dependencies). Commit the lockfile.
- `pnpm update-packages` (`app/scripts/update-packages.ts`, `--dry-run` to preview) applies
  minor and patch updates and lists major ones for review. A major upgrade gets its own PR and a
  read of the package's migration guide (for Next.js, the bundled `upgrading/` docs).

## Agent tooling

- Skills are installed once under `.agents/skills/` (pinned in `skills-lock.json`) and read from
  there by Cursor and, through the symlinks in `.claude/skills/`, by Claude Code. Refresh them
  with `pnpm skills:update` (from `app/`). Never hand-edit a lock-tracked skill; put repo-specific
  notes here instead.
- `agent-browser` is a dev dependency of `app/`, not a global install. Where a skill says to run
  `agent-browser` from `PATH`, run `pnpm exec agent-browser` in `app/` instead.
- The Next.js MCP endpoint is built in: `next dev` serves it at `/_next/mcp`. `next-dev-loop`
  uses it together with `agent-browser`.

## Security rules (always in force; details in `docs/security.md`)

- Nothing outside `app/src/server/session.ts` calls `auth()`.
- Pages that read data call `await requireUser()` themselves; route handlers are wrapped in
  `userRoute()`; every server action is built with `userAction()` / `userFormAction()` from
  `app/src/server/action.ts`.
- Per-person data is keyed by the session's `user.id`, never by an id from the input.
- Modules that hold the database, the Mealie token or user data start with
  `import "server-only"`.
- `app/src/server/access.test.ts` fails if any of this is skipped. Adding a public exception there
  is a deliberate, reviewed change.
- No secrets in the repo; CI runs gitleaks over the full history.

## Tests

- Unit tests sit next to the code as `*.test.ts`; Postgres tests are `*.db.test.ts`, tests
  against a real Mealie are `*.int.test.ts`. The e2e smoke test lives in `app/e2e/`.
- `pnpm test` (unit), `DATABASE_TEST_URL=… pnpm test:db`, `MEALIE_TEST_URL=… pnpm test:integration`,
  `pnpm test:e2e` against a running build (it empties `DATABASE_URL`; see the README).
- There is no component test setup (no jsdom/RTL). UI behaviour is covered by e2e.

## Environment variables

- The server's `.env` is documented in `.env.example`; the app reads `DATABASE_URL`,
  `AUTH_SECRET`, `AUTH_URL`, `MEALIE_URL`, `MEALIE_API_TOKEN` and `MEALIE_PUBLIC_URL`.
- A new variable goes into `.env.example` (with a comment), `docker-compose.yml` and
  `docs/deploy.md` in the same change. Read it only in server-only modules.

## Workflow

- Small and medium tasks: do them directly (implement, write the tests, run the checks below),
  then commit.
- Large or risky tasks (auth, data migrations, anything hard to reverse): a full round. Write
  the tests first (`unit-test-writer` / `e2e-test-writer`), build with `implementer`, validate
  with `code-reviewer`, re-invoke `implementer` with any blockers, commit when LGTM.
- After every edit to something user-visible, verify it at runtime with the `next-dev-loop`
  skill.

For a full task file, use `/execute-tasks path/to/tasks.md`. It applies the same split to every
task in the file, in dependency order.

## Code conventions

- Formatting is oxfmt and linting is oxlint (`app/.oxfmtrc.json`, `app/.oxlintrc.json`); don't
  argue with either in review.
- Braces on every `if`/`else`/loop body, even one-liners (`curly: all`).
- Components and helpers in `.tsx` are arrow-function expressions (`func-style`). Next.js route
  entries (`page`, `layout`, `error`, `not-found`, …) keep `export default function`.
- `"use client"` only where a component needs state, effects or browser APIs; data is read in
  Server Components through `app/src/server/*`, not through API routes.
- User-facing errors from server code are `UserFacingError`s (e.g. `PlanError`); anything else is
  logged and shown as a generic message.
- Comments explain *why*, not what the next line does. No references to task files, dates or
  "verified manually".
- One PR per milestone or issue. Merge with a merge commit: `.git-blame-ignore-revs` relies on
  commit SHAs surviving.

## Verification

After every change, from `app/`:

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
DATABASE_TEST_URL=postgres://… pnpm test:db     # if server/db code changed
```

then the `next-dev-loop` skill for anything user-visible.
