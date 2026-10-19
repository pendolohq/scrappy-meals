# Security policy

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's private reporting instead:
the repository's **Security** tab → **Report a vulnerability**.

Include what you found, how to reproduce it, and the version or commit. You
should get a reply within a week. Once a fix is released, the advisory is
published with credit to you unless you'd rather stay anonymous.

## Supported versions

Only the latest release and `main` receive fixes.

## Scope and design notes

- The app is meant to run behind the bundled Caddy reverse proxy; only Caddy
  publishes ports. Postgres and Mealie are reachable only on the internal
  Docker network.
- There is no self sign-up. Accounts are created with the `scrappy user` CLI
  inside the container. Passwords are argon2id hashes.
- The Mealie API token stays server-side and is never sent to the browser.
- Backups are encrypted client-side with age before upload; the server holds
  only the public key and write-only storage credentials.
