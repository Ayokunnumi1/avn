# Database schema

Source of truth: `packages/database/prisma/schema.prisma`; migrations in `packages/database/prisma/migrations`.

Conventions: UUID primary keys, FK constraints, `createdAt`/`updatedAt` in UTC, soft deletion (`deletedAt`) on users/organisations/requests, explicit enums, `Decimal(14,2)` for money (never floats).

## Entities (spec §7.1)

| Area | Models |
|---|---|
| Identity | `User`, `UserSession`, `OtpChallenge`, `PasswordResetToken`, `ApplicantProfile`, `VerifierProfile`, `VerifierIdentityCheck` |
| Organisations | `Organisation`, `OrganisationMember`, `OrganisationRole` |
| Geography | `Country`, `AdministrativeArea`, `Address` (+ generated `location geography`) |
| Requests | `VerificationRequest`, `RequestStatusEvent`, `ApplicantInvitation`, `VerificationPolicy`, `VerificationPolicyVersion`, `ApplicantDocument`, `StoredFile` |
| Assignment | `VerifierAvailability` (+ `location`), `VerifierLocation` (+ `location`), `AssignmentInvitation`, `VerificationAssignment` |
| Field & outcome | `FieldVisit`, `VerificationEvidence`, `VerificationFinding`, `VerificationReport`, `VerificationDispute`, `ManualReview`, `FraudSignal` |
| Money | `Payment`, `PaymentWebhookEvent`, `Wallet`, `WalletTransaction`, `Payout`, `PricingPlan`, `Invoice` |
| Messaging | `Notification`, `NotificationDelivery`, `NotificationTemplate`, `PushSubscription` |
| Integration | `ApiCredential`, `ApiRequestLog`, `WebhookSubscription`, `WebhookDelivery`, `BulkUpload` |
| AI | `AiAnalysis`, `AiUsageRecord` |
| Platform & privacy | `PlatformSetting`, `AuditEvent`, `ConsentRecord`, `DataSubjectRequest` |

## Hand-written SQL in the initial migration

- `location geography(Point,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) STORED` on `Address`, `VerifierAvailability`, `VerifierLocation`, with GiST indexes (declared in Prisma with `dbgenerated()` / `type: Gist` so `migrate dev` stays drift-free).
- `VerificationAssignment_one_active_per_request`: partial unique index on `requestId` where status is live.
- Trigger `WalletTransaction_immutable` rejects UPDATE/DELETE on the ledger.
- CHECK constraints keep verifier balances non-negative (organisation wallets may go negative only within postpaid credit, enforced in code).

## Tenant isolation (spec §7.3)

Institution-owned rows carry `organisationId`. Every institution query filters by the caller's organisation in the service layer (`requestDetail(id, { organisationId })`, `requestWhere(orgId, …)`), API-key routes scope by the key's organisation, and file access requires a short-lived signed link issued only after an authorisation check. `test/integration/tenancy.test.ts` proves cross-tenant access fails for requests, reports, evidence links, statements and API records.

## Retention

Verifier location history is purged after `locationRetentionDays` (default 30) by the maintenance sweep. Verification records are retained for audit and regulatory needs; deletion requests are handled through `DataSubjectRequest` subject to lawful retention.
