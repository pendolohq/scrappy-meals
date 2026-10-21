# Security model

The planner has two kinds of users: signed in and not. Every signed-in person
shares one household plan; a few things belong to one person only (their
profile, fasting days and adherence log). This page is about where those rules
are enforced, so a new page, action or route can't skip them.

## Where data is read

Pages are React Server Components and query Postgres directly
(`getWeekPlan(getDb(), …)`). That code runs only on the server and the browser
receives rendered output, not the query or the connection string, so it is
not a reason to add API routes. API routes exist only where the browser itself
calls in: recipe search and the recipe image proxy.

Modules that hold the database pool, the Mealie token or user data start with
`import "server-only"`, so importing one from a client component fails the
build. `src/server/domain/*` (pure date, macro and shopping maths) and
`src/server/db/schema.ts` (read by drizzle-kit) stay importable anywhere. The
CLI, the migration runner and the e2e setup run outside Next.js and resolve
`server-only` with the `react-server` condition instead (`build-cli.mjs`,
`bun run cli`, `bun run test:e2e`).

## Who is signed in: `src/server/session.ts`

Nothing outside this file calls `auth()`.

| Where | Use | Without a session |
| --- | --- | --- |
| Page or layout | `await requireUser()` | redirect to `/login` |
| Route handler | `export const GET = userRoute(async (req, ctx, user) => …)` | `401` |
| Server action | `userAction(schema, handler)` / `userFormAction(...)` from `src/server/action.ts` | `{ error }` |

Every page that reads data calls `requireUser()` itself. A layout doesn't
always re-render on client navigation, so it can't guard the pages below it.

## Server actions: `src/server/action.ts`

A server action is a public POST endpoint: anyone can call it with any
arguments, whatever the UI allows. So every action is built with `userAction`
(or `userFormAction` for `useActionState` forms), which in order:

1. rejects the call if nobody is signed in;
2. validates the input with the action's zod schema;
3. runs the handler with the parsed input and the signed-in user;
4. turns errors into `{ error }`: a `UserFacingError` (e.g. `PlanError`) keeps
   its message, anything else is logged and replaced by a generic message.
   Being signed out and a `RetryableError` (Mealie or the database down) add `retry: true`, so
   a caller with a queue (the shopping page) keeps the change and tries again.

Per-person data is keyed by `user.id` from the session, never by an id from
the input: fasting, adherence and settings work this way. Plan edits (meals,
portions, servings) and the household settings (snacks a day) are
household-wide on purpose: anyone signed in can change them.

"Today" comes from the device: the browser keeps its time zone in the `tz`
cookie (`src/lib/time-zone.ts`), read through `viewerToday()` in
`src/server/today.ts`. It's input like any other. `validTimeZone()` drops a
zone the runtime doesn't know (the server's `TZ` applies instead), and a
made-up far-east zone only lets someone log their own meals up to a day early,
which is fine.

## Defence in depth

- `src/proxy.ts` (Next.js middleware) redirects (or answers 401 under `/api/`) for everything
  except a short public list: `/login`, `/offline`, `/sw.js`, `/api/auth`,
  `/api/health`, `/manifest.webmanifest`, plus the static `/icons/` and `/screenshots/`
  (the install dialog's, taken from sample data). None of these read user data. It's a second layer: removing a path from that list
  must never be what keeps data private.
- Caddy sends `Permissions-Policy: camera=(self), microphone=(), geolocation=()` on the
  planner's host: the barcode scanner needs the camera, nothing needs the rest. The scanner's
  wasm is served from our own origin (`/zxing/`, behind sign-in like the rest), never a CDN.
- Sessions are JWTs (30 days) that carry a session version. Every request
  checks it against the database, so removing a user or changing a password
  (`scrappy user passwd`) signs out every device
  (`src/server/session-token.ts`). The one exception: while Postgres can't be
  reached, sessions are kept rather than all signed out. A revoked session then
  gets only Mealie's recipe search and images, since everything else needs the
  database, and ends on the first request after Postgres is back.
- The service worker (`public/sw.js`) keeps this week's pages, the weeks
  you've opened and recipe photos for offline use. They're the household's
  data, so they're dropped on sign-out, and as soon as a page request
  bounces to `/login` (the session ended elsewhere). Anything new it caches
  that holds user data goes into the same caches.
- Auth.js sets the session cookie `HttpOnly`, `SameSite=Lax`, and `Secure` when
  `AUTH_URL` is https. Caddy terminates TLS; the app port isn't published.
- Sign-in failures are rate-limited per IP, per email from one IP, and per
  email overall (`createSignInLimits` in `src/server/rate-limit.ts`), so
  guessing someone's password can't lock them out of their own device.

## Tests

`src/server/access.test.ts` finds every `"use server"` file, route handler and
page under `src/app` and fails if:

- an action answers anything but `{ error }` without a session, or touches the
  database or Mealie;
- a route handler answers anything but `401` without a session;
- a page or layout that reads data (itself, or through a component it renders)
  doesn't call `requireUser()`, in any route group;
- a `"use server"` appears anywhere but the first line of a file under `src`
  (an inline server action would skip the checks above).

Public exceptions (the login action and page, `/offline`, `/api/auth`,
`/api/health`) are listed
in that file. Adding one is a deliberate, reviewed change.
