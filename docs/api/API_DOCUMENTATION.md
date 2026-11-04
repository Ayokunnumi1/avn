# API documentation

- Base URL: `/api/v1` · Interactive docs: **`/api/docs`** · Spec: `/api/v1/openapi.json` (generated from the route registry; ~170 operations).
- Errors: `{ "error": { "code", "message", "details?", "requestId" } }` with HTTP 400 validation, 401 unauthenticated, 402 insufficient funds, 403 forbidden, 404 not found / not yours, 409 conflict or illegal state transition, 413 too large, 422 business rule, 429 rate limited, 503 provider unavailable.

## Authentication

| Client | Mechanism |
|---|---|
| Browser apps | httpOnly cookie `avn_<app>_session` + header `X-AVN-App: applicant\|verifier\|business\|admin` (required for mutations — CSRF guard). Sessions are audience-bound. |
| Institutions (server-to-server) | `Authorization: Bearer avn_live_<prefix>.<secret>` with scopes `requests:write`, `requests:read`, `reports:read`; 120 requests/min per key |

## Route groups

| Prefix | Audience | Highlights |
|---|---|---|
| `/auth` | all | `otp/request`, `otp/verify`, `register`, `login` (TOTP step-up), `logout(-all)`, `me`, `sessions`, `password/forgot|reset`, `mfa/setup|enable|disable` |
| `/me` | applicant | `dashboard`, `requests`, `requests/:id` (timeline), `quote`, `requests` POST (individual), `:id/pay`, `:id/submit`, `:id/documents`, `:id/visit/confirm`, `:id/disputes`, `data-requests` |
| `/invitations/:token` | public | open, `otp`, `verify` (guest session scoped to one request) |
| `/verifiers` | verifier | `register`, `me`, `me/photo`, `me/identity`, `me/payout-account`, `banks`, `me/availability`, `me/heartbeat`, `me/offers`, `me/earnings`, `me/payouts`, `me/performance` |
| `/offers/:id` | verifier | `accept` (idempotent, atomic), `decline` |
| `/assignments` | verifier | list, `:id`, `:id/route`, `en-route`, `arrive`, `evidence` (multipart), `confirmation-code(/verify)`, `draft`, `incidents`, `release`, `submit` (idempotent) |
| `/org`, `/org/requests`, `/org/bulk`, `/org/billing`, `/org/developers`, `/org/assistant` | business (RBAC) | onboarding, dashboard, members, policies (versions), requests (filters, detail, cancel, invitation, disputes, reverify), bulk CSV, wallet/top-up/statements/invoices, API keys, webhooks, usage, assistant, audit |
| `/integrations/verifications` | API key | create (`Idempotency-Key`), get by id/reference, `report.pdf` |
| `/payments` | mixed | `webhooks/:provider` (signed), `:reference/status` (server-side verification), simulator checkout (dev only) |
| `/reports` | mixed | `:id/pdf`, `:id/share`, `shared/:id`, `verify/:reference` (public) |
| `/notifications`, `/files/:id`, `/geo`, `/public` | mixed | inbox, push subscriptions, signed file links, areas/search/reverse/parse, pricing/contact |
| `/admin/*` | admin (per-permission) | overview, users, admins, verifiers, organisations, requests/map/assign/reassign/redispatch/cancel, reviews, fraud, evidence, disputes, finance, config, pricing, templates, geo, ai, audit, data-requests |

## Webhooks

Events: `verification.created`, `verification.status_changed`, `verification.completed`, `report.issued`, `dispute.updated`.

```
POST <your url>
X-AVN-Event: verification.completed
X-AVN-Delivery: <uuid>
X-AVN-Signature: t=1730736000,v1=<hex HMAC-SHA256(secret, "1730736000.<raw body>")>
```

Verify the signature against the raw body, reject timestamps older than 5 minutes, and de-duplicate on `X-AVN-Delivery`. Failed deliveries retry with exponential backoff (up to 6 attempts); history is visible in the Business app.

See [institution integration guide](../operations/INSTITUTION_INTEGRATION.md) for an end-to-end example.
