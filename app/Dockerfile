# syntax=docker/dockerfile:1
# Bun only installs packages and runs the build scripts; Node runs everything.
# Keep the version in step with packageManager in package.json.
FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS bun

FROM node:26-alpine@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5 AS base
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM node:26-alpine@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5 AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
# The code stays root-owned, so a compromised server process can't rewrite it.
# Only Next's cache directory is writable.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/dist/cli.cjs /app/dist/migrate.cjs ./
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/entrypoint
COPY --chmod=0755 docker/scrappy /usr/local/bin/scrappy
RUN mkdir -p .next/cache && chown node:node .next/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
ENTRYPOINT ["entrypoint"]
CMD ["node", "server.js"]
