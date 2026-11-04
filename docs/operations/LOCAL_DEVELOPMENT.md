# Local development

1. Install Node 22, pnpm 10 (`corepack enable`), PostgreSQL 16 with PostGIS, Redis 7 — or run `docker compose up -d postgres redis`.
2. `cp .env.example .env` (defaults work locally; simulators are enabled and clearly labelled).
3. `pnpm install && pnpm db:generate && pnpm db:deploy && pnpm db:seed`
4. `pnpm dev` starts the API (4000), worker and the four apps (3000–3003).

Useful commands

| Command | Purpose |
|---|---|
| `pnpm db:migrate` | create a new migration after editing `schema.prisma` |
| `pnpm db:reset` | wipe, migrate and reseed (development only) |
| `pnpm --filter @avn/api simulate:verifiers 8 --accept` | keep 8 seeded verifiers on duty (dev simulator) |
| `node infrastructure/scripts/generate-pwa-assets.mjs` | regenerate manifests, icons and service workers |
| `pnpm test` | all tests; API integration tests use `TEST_DATABASE_URL` (migrated automatically) |
| `node e2e/full-flow.cjs` | browser E2E across all apps against the running stack |

Tips: OTP codes and email links are displayed on screen in development (`OTP_DEV_ECHO=true`). Set `JOBS_MODE=inline` to run background jobs inside the API without the worker. Service workers register only in production builds (`next build && next start`).
