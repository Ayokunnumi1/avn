# Railway deployment

Everything (API, Postgres, Redis, the four web apps) can run in one Railway project. Each service has a
config-as-code file in [`railway/`](railway/) that sets its Dockerfile, health check, restart policy,
watch paths and (for the API) the migration pre-deploy command.

> The `railway/*.json` files follow Railway's config-as-code schema (`build.builder`, `build.dockerfilePath`,
> `deploy.preDeployCommand`, `deploy.healthcheckPath`, …). If Railway rejects a field, set the same value in
> the service's Settings tab instead — the values in the table below are the source of truth.

## 1. Services

Connect the GitHub repo once per app service (Root Directory = repo root; the Dockerfiles need the whole
workspace). Then in each service's **Settings → Config-as-code** point at its file and add the `APP` variable
(it is the Dockerfile build argument that picks the app).

| Service | Config file | Variable `APP` | Public domain → port | Notes |
|---|---|---|---|---|
| postgres | — | — | none | Deploy the **`postgis/postgis:16-3.4`** image (Railway's stock Postgres has no PostGIS). Attach a volume at `/var/lib/postgresql/data`. The first migration runs `CREATE EXTENSION postgis`. |
| redis | — | — | none | Railway Redis template. Optional for the demo (see `JOBS_MODE`). |
| api | `infrastructure/deployment/railway/api.json` | `api` | yes → `4000` | Attach a **volume at `/app/storage-data`** (evidence photos, signed PDF reports). Runs `prisma migrate deploy` before each deploy; health check `/health`. |
| applicant-web | `…/railway/applicant-web.json` | `applicant-web` | yes → `3000` | |
| verifier-web | `…/railway/verifier-web.json` | `verifier-web` | yes → `3000` | |
| business-web | `…/railway/business-web.json` | `business-web` | yes → `3000` | |
| admin-web | `…/railway/admin-web.json` | `admin-web` | yes → `3000` | Optionally restrict with `ADMIN_IP_ALLOWLIST` on the api. |
| worker *(optional)* | `…/railway/worker.json` | `worker` | none | Only with object storage — see below. |

### Why there is no worker by default

A Railway volume attaches to **one** service. Verification reports and evidence files are written to local disk,
so a separate worker container could not see the files the API stores. For the MVP run the background jobs inside
the API process with `JOBS_MODE=inline` (the API then also runs the 30-second maintenance sweep: offer expiry,
SLA escalation, payout batching). Add the worker service once storage moves to object storage (add an S3/R2 driver to
`packages/storage`), and set `JOBS_MODE=queue` + `REDIS_URL` on both.

## 2. API variables

Generate each secret with `openssl rand -hex 32`. Use Railway references for the plugin URLs, e.g.
`DATABASE_URL=${{postgres.DATABASE_URL}}` (append `?schema=public` if needed) and `REDIS_URL=${{redis.REDIS_URL}}`.

**Hackathon / demo (simulators on)** — `APP_ENV=staging` allows the payment, SMS, email and identity simulators:

```
APP_ENV=staging
NODE_ENV=production
API_PORT=4000
API_PUBLIC_URL=https://<api-domain>
APPLICANT_APP_URL=https://<applicant-domain>
VERIFIER_APP_URL=https://<verifier-domain>
BUSINESS_APP_URL=https://<business-domain>
ADMIN_APP_URL=https://<admin-domain>
CORS_ORIGINS=https://<applicant-domain>,https://<verifier-domain>,https://<business-domain>,https://<admin-domain>
TRUST_PROXY=2
DATABASE_URL=${{postgres.DATABASE_URL}}
SESSION_SECRET=<hex>
REPORT_SIGNING_SECRET=<hex>
STORAGE_SIGNING_SECRET=<hex>
DATA_ENCRYPTION_KEY=<hex>
JOBS_MODE=inline
OTP_DEV_ECHO=true
SEED_DEMO_DATA=true
```

- `SEED_DEMO_DATA=true` seeds demo accounts and five end-to-end requests (reports included) on the next start,
  inside the container so the files land on the volume. The seed is skipped when an admin already exists and is
  refused when `APP_ENV=production`. Remove the variable after the first successful deploy.
- `TRUST_PROXY` is the number of proxy hops in front of the API (Railway edge = 1; web app proxy = +1). It drives
  the per-IP rate limits and audit IP addresses.
- The API needs its **own public domain**: the payment-simulator checkout page and signed file links are served
  from `API_PUBLIC_URL`.

**Production** — `APP_ENV=production` refuses to boot with simulators or development secrets. Additionally set:

- `OTP_DEV_ECHO=false`, remove `SEED_DEMO_DATA`
- `PAYMENT_PROVIDER=paystack`, `PAYOUT_PROVIDER=paystack`, `PAYSTACK_SECRET_KEY`; Paystack webhook URL
  `https://<api-domain>/api/v1/payments/webhooks/paystack`
- `SMS_PROVIDER=termii` + `TERMII_API_KEY`; `EMAIL_PROVIDER=smtp` + `SMTP_URL` + `EMAIL_FROM`
- `IDENTITY_PROVIDER=manual` (or a real adapter); optional `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`
- `ROUTING_PROVIDER=valhalla` + `VALHALLA_URL` for real road distances

See `.env.example` for every variable.

## 3. Web app variables

The `/api/*` proxy target is compiled into the Next.js build, so these must be present **at build time**
(Railway passes service variables to Docker builds as build arguments):

```
APP=applicant-web            # or verifier-web / business-web / admin-web
API_INTERNAL_URL=http://api.railway.internal:4000
API_PUBLIC_URL=https://<api-domain>
```

Applicant web only (marketing links): `NEXT_PUBLIC_BUSINESS_APP_URL`, `NEXT_PUBLIC_VERIFIER_APP_URL`.

`API_INTERNAL_URL` uses Railway's private network (the API listens on `::`, so the IPv6 private DNS works). If the
web apps cannot reach it, use the API's public URL instead. Changing either value requires a **redeploy** of the
web service, not just a restart.

Browsers only ever talk to their own web app's origin; session cookies are first-party and the API does not need
to be on the same parent domain.

## 4. First deploy order

1. postgres (+ redis if used) → 2. api (migrations run, seed runs) → check `https://<api-domain>/health` returns
`{"status":"ok","db":"ok"}` → 3. the four web apps → 4. sign in with the demo accounts listed in the README.

Custom domains: point e.g. `app.`, `agent.`, `business.`, `admin.` and `api.` at the services, then update the
`*_APP_URL`, `CORS_ORIGINS`, `API_PUBLIC_URL` variables and redeploy the web apps.
