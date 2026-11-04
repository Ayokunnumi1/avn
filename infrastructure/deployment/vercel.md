# Vercel (web apps) + Railway (API)

Vercel can host the four Next.js apps. It cannot host the API: the API is a long-running Express server with
background jobs, a PostGIS database and a disk for evidence files and PDF reports. Deploy the API, Postgres
(+ PostGIS) and optionally Redis on Railway first — follow [railway.md](railway.md) sections 1–2 and skip the
web services.

## 1. One Vercel project per app

Import the GitHub repo four times (one project each):

| Project | Root Directory |
|---|---|
| avn-applicant | `apps/applicant-web` |
| avn-verifier | `apps/verifier-web` |
| avn-business | `apps/business-web` |
| avn-admin | `apps/admin-web` |

Each app has a `vercel.json` (framework `nextjs`, `pnpm install --frozen-lockfile`, `next build`). Keep Vercel's
default "Include files outside the Root Directory" setting on — the apps compile the shared `packages/ui` and
`packages/contracts` sources. On Vercel the apps build without `output: 'standalone'` automatically (the
`VERCEL` variable switches it off).

## 2. Environment variables (each project, Production + Preview)

```
API_INTERNAL_URL=https://<railway-api-domain>
API_PUBLIC_URL=https://<railway-api-domain>
```

Applicant project only: `NEXT_PUBLIC_BUSINESS_APP_URL=https://<business-domain>`,
`NEXT_PUBLIC_VERIFIER_APP_URL=https://<verifier-domain>`.

The `/api/*` rewrite to the API is fixed at build time, so **redeploy** after changing these. Railway's private
network is not reachable from Vercel, so `API_INTERNAL_URL` is the API's public URL.

## 3. Point the API at the Vercel domains

On the Railway API service set the Vercel URLs and redeploy:

```
APPLICANT_APP_URL=https://avn-applicant.vercel.app
VERIFIER_APP_URL=https://avn-verifier.vercel.app
BUSINESS_APP_URL=https://avn-business.vercel.app
ADMIN_APP_URL=https://avn-admin.vercel.app
CORS_ORIGINS=https://avn-applicant.vercel.app,https://avn-verifier.vercel.app,https://avn-business.vercel.app,https://avn-admin.vercel.app
TRUST_PROXY=2
```

Requests reach the API as browser → Vercel → Railway edge → API, so the client IP used for rate limits is the
Vercel egress address rather than the end user's. That is acceptable for a demo; for production put the web apps
on Railway too (or behind a proxy you control) so per-user rate limits stay meaningful.

Preview deployments get random URLs that are not in `CORS_ORIGINS`/`*_APP_URL`; same-origin proxying still works,
but links in emails and redirects after payment go to the production URLs.
