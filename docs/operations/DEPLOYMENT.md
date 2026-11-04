# Deployment

Initial target: **Railway** — see [`infrastructure/deployment/railway.md`](../../infrastructure/deployment/railway.md) for the service map and required environment.

Images: `infrastructure/docker/node.Dockerfile` (`APP=api|worker`) and `infrastructure/docker/web.Dockerfile` (`APP=applicant-web|verifier-web|business-web|admin-web`). Each app is independently deployable; the web apps only need `API_INTERNAL_URL` at runtime.

Release checklist

1. CI green (typecheck, lint, tests on PostGIS, builds).
2. Run migrations: `prisma migrate deploy` (Railway pre-deploy command on the API service).
3. Deploy API, then worker, then web apps.
4. Verify `GET /health` (db ok, redis ready), sign in to each app, check `/api/docs`.
5. Configure Paystack webhook → `/api/v1/payments/webhooks/paystack`.

Monitoring & logging: structured JSON logs (pino) with request IDs; `/health` for uptime checks; failed jobs are logged by the worker; webhook/notification delivery status is stored per attempt. Plug in your error reporter (e.g. Sentry) at `apps/api/src/lib/errors.ts` and the Next.js `instrumentation` hook.

Rollback: redeploy the previous image; migrations are additive — write a forward fix rather than down-migrating production.
