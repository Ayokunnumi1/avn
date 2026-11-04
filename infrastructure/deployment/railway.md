# Railway deployment

Create one Railway project with these services (each independently deployable):

| Service | Dockerfile | Build arg | Start / notes |
|---|---|---|---|
| postgres | Railway PostgreSQL **with PostGIS** (use the `postgis/postgis:16-3.4` image template) | — | Run `CREATE EXTENSION postgis;` is handled by the migration |
| redis | Railway Redis | — | |
| api | `infrastructure/docker/node.Dockerfile` | `APP=api` | Pre-deploy command: `npx prisma@6.19.3 migrate deploy --schema=prisma/schema.prisma` · health check `/health` · attach a volume at `/app/storage-data` |
| worker | `infrastructure/docker/node.Dockerfile` | `APP=worker` | Same env as api, same volume (or switch storage to object storage) |
| applicant-web | `infrastructure/docker/web.Dockerfile` | `APP=applicant-web` | `API_INTERNAL_URL=http://api.railway.internal:4000` |
| verifier-web | same | `APP=verifier-web` | |
| business-web | same | `APP=business-web` | |
| admin-web | same | `APP=admin-web` | Optionally set `ADMIN_IP_ALLOWLIST` on the api |

Production environment (api + worker) — see `.env.example` for the full list. `@avn/config` **refuses to boot** with
simulators or development secrets when `APP_ENV=production`, so you must set:

- `APP_ENV=production`, `TRUST_PROXY=true`, `API_PUBLIC_URL`, `*_APP_URL`, `CORS_ORIGINS`
- `SESSION_SECRET`, `REPORT_SIGNING_SECRET`, `STORAGE_SIGNING_SECRET` (`openssl rand -hex 32` each), `DATA_ENCRYPTION_KEY` (`openssl rand -hex 32`)
- `PAYMENT_PROVIDER=paystack`, `PAYOUT_PROVIDER=paystack`, `PAYSTACK_SECRET_KEY`; set the Paystack webhook URL to `https://<api>/api/v1/payments/webhooks/paystack`
- `SMS_PROVIDER=termii` + `TERMII_API_KEY`; `EMAIL_PROVIDER=smtp` + `SMTP_URL`; `OTP_DEV_ECHO=false`
- `IDENTITY_PROVIDER=manual` (or a real provider adapter), optional `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`
- `ROUTING_PROVIDER=valhalla` + `VALHALLA_URL` (self-host Valhalla with Nigeria OSM extract for production volume)

HTTPS and custom domains are provided by Railway; point e.g. `app.`, `agent.`, `business.`, `admin.` and `api.` subdomains at the services.
