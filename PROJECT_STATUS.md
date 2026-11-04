# Project status

_Last updated: 2026-11-04. This file is deliberately honest: "simulated" means the production adapter exists but the demo uses a labelled development simulator because credentials are not available._

## Verified in this build

| Check | Result |
|---|---|
| `pnpm typecheck` | 20/20 packages pass (strict TS, `noUncheckedIndexedAccess`) |
| `pnpm lint` | 0 errors |
| `pnpm test` | 122 tests pass — 23 engine unit tests, 53 API integration tests on real PostgreSQL 16 + PostGIS, 46 package tests |
| `pnpm build` | API, worker and all four Next.js PWAs build for production |
| Production bundles | API boots (`/health` → db ok, redis ready); worker boots; 170 OpenAPI operations |
| Browser E2E (`e2e/full-flow.cjs`) | Business creates request → applicant (iPhone emulation) completes wizard + map pin → agent (Pixel emulation, fake camera, emulated GPS) goes on duty, accepts, arrives, captures 3 photos, submits → **COMPLETED / VERIFIED** → report visible to applicant and institution → admin overview |

## Phase acceptance (spec Part 13)

| Phase | Status | Notes |
|---|---|---|
| 0 Repository & architecture | ✅ | pnpm + Turborepo monorepo, env strategy, docs |
| 1 Foundation & design system | ✅ | 4 Next.js apps, API, worker, shared UI, PWA foundations |
| 2 Database & authentication | ✅ | Prisma/PostGIS schema, OTP, password, TOTP MFA, sessions, RBAC, org isolation |
| 3 Applicant & institution workflows | ✅ | Requests, secure invitations, wizard, map, documents, individual purchase |
| 4 Verifier onboarding | ✅ | Registration, identity adapter, manual approval, availability, heartbeat, dashboards |
| 5 Location & assignment engine | ✅ | PostGIS candidates, pedestrian routing adapter, tiers, atomic acceptance, expiry, reassignment |
| 6 Physical verification | ✅ | Navigation, arrival validation, camera capture, evidence, checklist, codes, drafts, offline queue |
| 7 Verification engine & reports | ✅ | Versioned deterministic rules, policies, manual review, signed PDFs, verification endpoint, disputes |
| 8 AI intelligence | ✅ (optional) | Provider adapter, address parsing, OCR, evidence quality, fraud rules, report wording, usage/budgets |
| 9 Payments & business operations | ✅ | Paystack adapter, wallets, ledger, payouts, reconciliation, statements/invoices, refunds |
| 10 Administration | ✅ | Full operations centre |
| 11 API & enterprise integration | ✅ | API keys, REST, signed webhooks, bulk CSV, usage, rate limits |
| 12 Testing & hardening | ✅ (MVP scope) | See "Not yet done" for performance and backup drills |
| 13 Deployment & handover | ✅ (docs + configs) | Dockerfiles/compose/CI written; **Docker images were not built in the development sandbox** (no Docker daemon) |

## External integrations

| Integration | Production adapter | Demo mode |
|---|---|---|
| Payments | Paystack initialize / verify / refund / transfers, HMAC-SHA512 webhooks | **Simulator** (signed webhooks, same code path) |
| Payouts | Paystack Transfers | **Simulator** (accounts ending `0000` fail on purpose) |
| SMS | Termii | Console (OTP shown on screen labelled "Development simulator") |
| Email | SMTP (nodemailer) | Console |
| Web push | VAPID (web-push) | Disabled until keys are set |
| Identity | Manual admin review (default) | Simulator for local testing |
| AI | Anthropic Claude (`claude-opus-5-5` default, per-feature configurable) | Disabled — deterministic fallbacks |
| Geocoding | Nominatim | Works when outbound access is allowed |
| Pedestrian routing | Valhalla (`costing: pedestrian`, matrix) | Labelled straight-line **estimate** fallback; source stored on every offer |
| Maps | OpenStreetMap tiles via Leaflet | — |

`@avn/config` refuses to start with any simulator or development secret when `APP_ENV=production`.

## Not yet done / known limitations

- **Object storage**: local private disk adapter only; S3/R2 adapter is the next step (interface ready). Single-host storage means API and worker must share a volume.
- **Malware scanning**: integration point exists (`MalwareScanner`), no scanner wired (files recorded as `NOT_SCANNED`). MIME is verified by magic bytes.
- **Multiple verifiers per request** (`verifierCount` policy field) is stored but dispatch assigns one verifier.
- **Anomaly detection** (ML) intentionally deferred until labelled data exists; deterministic rules only.
- **Performance/load testing and backup-restore drills** were not executed; procedures are documented.
- **Native Android app** for background location is a future phase (PWAs need the app open while on duty).
- QR codes on reports are not rendered (reference + hash + verification URL are).
- Valhalla/Nominatim/OSM tiles were unreachable from the build sandbox, so routing ran in labelled estimate mode during testing.
