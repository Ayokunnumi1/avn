# Deployment

- **Railway (everything)** — [`infrastructure/deployment/railway.md`](../../infrastructure/deployment/railway.md); per-service config-as-code in `infrastructure/deployment/railway/*.json`.
- **Vercel (web apps) + Railway (API, Postgres)** — [`infrastructure/deployment/vercel.md`](../../infrastructure/deployment/vercel.md); each web app has a `vercel.json`.

Images: `infrastructure/docker/node.Dockerfile` (`APP=api|worker`) and `infrastructure/docker/web.Dockerfile` (`APP=applicant-web|verifier-web|business-web|admin-web`). The web apps' `/api/*` proxy target (`API_INTERNAL_URL`) is compiled in at **build** time. The API image runs the bundled demo seed on start when `SEED_DEMO_DATA=true` (non-production only) and, with `JOBS_MODE=inline`, runs jobs and the maintenance sweep in-process so no worker or Redis is required.

Release checklist

1. CI green (typecheck, lint, tests on PostGIS, builds).
2. Run migrations: `prisma migrate deploy` (Railway pre-deploy command on the API service).
3. Deploy API (and worker if using `JOBS_MODE=queue`), then web apps.
4. Verify `GET /health` (db ok, redis ready), sign in to each app, check `/api/docs`.
5. Configure Paystack webhook → `/api/v1/payments/webhooks/paystack`.

Monitoring & logging: structured JSON logs (pino) with request IDs; `/health` for uptime checks; failed jobs are logged by the worker; webhook/notification delivery status is stored per attempt. Plug in your error reporter (e.g. Sentry) at `apps/api/src/lib/errors.ts` and the Next.js `instrumentation` hook.

Rollback: redeploy the previous image; migrations are additive — write a forward fix rather than down-migrating production.
