# Architecture

## Overview

```
 Browser PWAs (Next.js 15, same-origin /api proxy)          External providers (adapters)
 ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐       Paystack · Termii · SMTP · Web Push
 │ User 3000│ │Agent 3001│ │Business   │ │Admin 3003│       Anthropic · Valhalla · Nominatim
 └────┬─────┘ └────┬─────┘ │  3002     │ └────┬─────┘                 ▲
      └────────────┴───────┴────┬──────┴──────┘                       │
                    /api/v1 (httpOnly cookie + X-AVN-App)             │
                 ┌──────────────▼───────────────┐   enqueue   ┌───────┴────────┐
                 │  API — Express modular       ├────────────►│ Worker (BullMQ │
                 │  monolith (apps/api)         │   Redis     │ + 30 s sweep)  │
                 └──────────────┬───────────────┘             └───────┬────────┘
                                │ Prisma + raw PostGIS SQL            │
                         ┌──────▼────────────────────────────────────▼──┐
                         │ PostgreSQL 16 + PostGIS │ private file storage│
                         └──────────────────────────────────────────────┘
```

- **Modular monolith.** All domain modules live in `apps/api/src/modules/*`; the worker is a separate process that imports the same job registry (`@avn/api/jobs`). No microservices, Kafka or Kubernetes (spec §8.1).
- **Shared packages.** `@avn/contracts` (enums, state machine, RBAC matrices, Zod schemas) is used by API and frontends, so validation rules and statuses never diverge. Provider SDKs are isolated in `payments`, `maps`, `storage`, `notifications`, `ai`, `reporting`.
- **Frontends are thin.** No business logic in React components; every rule is enforced in the API. Each PWA proxies `/api/*` to the API so session cookies are first-party and per-app (`avn_<app>_session`).

## Key design decisions

| Decision | Rationale |
|---|---|
| Typed route registry (`lib/http.ts`) | One declaration validates the request (Zod) *and* generates OpenAPI, so docs cannot drift |
| State machine in `@avn/contracts` + `transition()` | Every status change is legal, optimistic-concurrency checked and recorded in `RequestStatusEvent`; side effects run after commit (`withTx` + `after`) |
| Generated geography columns | PostGIS points are maintained by Postgres from `lat/lng`, so Prisma never writes geometry; GiST indexes power `ST_DWithin` |
| Three guards against double assignment | Conditional status update, partial unique index on live assignments, idempotency keys |
| Deterministic engine, AI advisory only | Outcomes must be explainable and reproducible (`avn-rules@1.0.0`); AI output is stored as labelled suggestions |
| Outbox-style recovery | Deliveries, webhooks, dispatch, processing and reports are all re-derivable from DB state, so a Redis outage or worker restart loses nothing |
| Ledger | Balances change only inside `postEntry` with a row lock and an immutable `WalletTransaction` (DB trigger forbids UPDATE/DELETE) |
| Policy snapshots | Requests freeze the policy version at creation; new versions never change existing requests |
| Config validation | `@avn/config` refuses simulators and development secrets in production |

## Request lifecycle

`CREATED → AWAITING_APPLICANT → READY_FOR_ASSIGNMENT → DISPATCHING → ACCEPTED → EN_ROUTE → ARRIVED → VISIT_IN_PROGRESS → EVIDENCE_SUBMITTED → PROCESSING → COMPLETED | PARTIALLY_VERIFIED | NOT_VERIFIED | INCONCLUSIVE | MANUAL_REVIEW`, plus `ASSIGNED` (manual), `CANCELLED`, `EXPIRED`. Legal transitions: `packages/contracts/src/state-machine.ts`.

## Assignment engine (spec Part 5)

1. PostGIS pre-filter: available, approved, active-user verifiers with a fresh heartbeat inside `minutes × 80 m/min × 1.1`.
2. Exclusions (pure, tested): not approved, unavailable, stale location, busy, conflict of interest (same phone/user, home within 150 m), already invited.
3. Pedestrian routing matrix (Valhalla) → keep candidates within the tier → rank by walking time, then reliability.
4. Invite top N (default 3) with an expiry; none → expand tier (15 → 20 → 30 → 45); exhausted → keep open for delayed assignment and surface fallbacks (alternative transport / professional agent). The maintenance sweep retries.

## Verification engine (spec Part 6)

Seven findings — building existence, address match, occupancy, applicant presence, residency confirmation, contactability, evidence integrity — each with value + basis. Outcome rules: risk/integrity/GPS exceptions → manual review; contradictions → not verified; missing evidence → inconclusive; building + address confirmed → verified if policy residency/presence requirements are met, else partially verified. Absence, documents and confirmation codes never establish (or refute) residence on their own. See `apps/api/src/modules/verification/engine.ts` and its tests.

## PWA design

Each app has its own manifest, icons, service worker (`infrastructure/scripts/generate-pwa-assets.mjs`), offline page, network banner and update prompt. The service worker never caches `/api/*`. The Agent app keeps evidence in an IndexedDB queue until acknowledged and checklist drafts in local + server storage.
