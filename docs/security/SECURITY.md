# Security

Security is a release requirement (spec Part 12). Status of each control:

| # | Control | Implementation |
|---|---|---|
| 1 | Password hashing | scrypt (N=2¹⁵, r=8, p=1, per-password salt); constant-work on unknown accounts |
| 2 | OTP expiry & rate limits | 10-minute HMAC-hashed codes, 5 attempts, per-destination and per-IP limits |
| 3 | Session rotation | New session on every login and on MFA enrolment (all others revoked); password reset revokes all sessions |
| 4 | Secure cookies | httpOnly, SameSite=Lax, Secure on HTTPS, per-app names, audience-bound server-side |
| 5 | CSRF | Custom `X-AVN-App` header required for cookie-authenticated mutations; strict CORS allow-list |
| 6 | CORS | Only configured app origins with credentials |
| 7 | Input validation | Zod on every body/query; UUID param validation |
| 8 | SQL injection | Prisma; raw SQL only via tagged templates (parameterised); AI never generates SQL |
| 9 | XSS | React escaping, CSP headers on all apps, escaped simulator HTML, CSV formula-injection escaping |
| 10–12 | Uploads | Magic-byte MIME detection, allow-lists per purpose, 12 MB limit, in-memory parsing |
| 13 | Malware scanning | `MalwareScanner` integration point (status persisted); no scanner configured yet |
| 14–15 | Private storage, short-lived links | Files outside web roots; HMAC-signed links valid 10 minutes, issued after authorisation; access audited |
| 16 | Encryption in transit | HTTPS via platform; HSTS header |
| 17 | Encryption at rest | AES-256-GCM for ID numbers, payout account numbers, MFA secrets, webhook secrets; managed DB disk encryption |
| 18 | Secret management | Env-only, validated at boot; production refuses dev secrets/simulators; never exposed to frontends (server-side proxy) |
| 19 | Rate limiting | Global + per-route limiters (Redis with in-memory insurance) |
| 20, 24 | Audit logs | `AuditEvent` for logins, failures, approvals, money, config, evidence views, downloads |
| 21 | RBAC | Org role matrix and admin permission matrix in `@avn/contracts`, enforced by route guards |
| 22 | Tenant isolation | Service-layer org scoping; integration tests prove isolation |
| 23 | Suspension | Revokes sessions, availability, offers and (orgs) API keys |
| — | MFA | RFC 6238 TOTP (tested against RFC vectors); required step-up when enabled; admins cannot disable |
| — | Privileged actions | Payout decisions, refunds, platform & AI config require password re-confirmation |
| — | Admin IP restriction | Optional `ADMIN_IP_ALLOWLIST` |
| — | Payments | Server-side verification, amount/currency match, signed + de-duplicated webhooks, idempotent ledger, no card data stored |
| — | Logging | pino with redaction of passwords, tokens, cookies, OTPs, account numbers |

## Privacy (NDPA 2023)

Privacy notice (versioned), consent records per request (`ConsentRecord`), data-access audit (`evidence.viewed`, `report.downloaded`), data-subject request workflow (applicant → admin), location retention purge, minimised notifications (lock-screen-safe copy), verifier live locations never exposed to applicants/other verifiers, precise addresses hidden from unassigned verifiers (offers show district/city and coarse coordinates only).

## Breach response

1. Contain: revoke affected sessions/API keys (admin tools), rotate `SESSION_SECRET`/signing secrets, disable affected integrations.
2. Assess scope from `AuditEvent` and infrastructure logs; preserve evidence.
3. Notify the Nigeria Data Protection Commission within 72 hours where required, and affected data subjects without undue delay.
4. Remediate, document root cause, add regression tests.

## Reporting vulnerabilities

Email security contacts listed by the operator; do not open public issues for vulnerabilities.
