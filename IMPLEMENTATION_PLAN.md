# Implementation plan

Work followed the strictly phased approach in the master prompt; each phase was developed on a branch, checked (typecheck, lint, tests, build) and merged with `--no-ff` into the integration branch.

| Branch | Phases | Contents |
|---|---|---|
| `feat/phase-0-1-foundation` | 0–1 | Monorepo, config, contracts (state machine, RBAC, schemas), utilities, logger |
| `feat/phase-2-database-auth` | 2 + adapters | Prisma/PostGIS schema & migration, auth primitives, payments/maps/storage/notifications/AI/reporting adapters |
| `feat/phase-3-api-core` | 2–11 backend | API modules, engines, worker, seed, 76 API tests |
| `feat/phase-4-pwa-frontends` | 1, 3–10 frontend | Design system, four PWAs, E2E, Docker/CI, documentation |

## Next steps (post-MVP)

1. S3-compatible object storage adapter + ClamAV scanner adapter; move evidence off the API host.
2. Self-hosted Valhalla with a Nigeria OSM extract; cache walking matrices.
3. Real identity provider adapter (e.g. NIN/BVN verification vendor) behind `IdentityProvider`.
4. Multi-verifier dispatch for `verifierCount > 1` and professional field-agent pool for no-coverage areas.
5. Load tests (k6) for dispatch and evidence upload; scheduled backup-restore drills.
6. Native Android wrapper for background duty location.
7. Report QR codes; institution-branded report templates.
8. Anomaly detection once labelled review outcomes accumulate.
