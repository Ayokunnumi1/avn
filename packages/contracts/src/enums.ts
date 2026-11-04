/**
 * Domain enumerations shared by the API, worker and all four PWAs.
 * The Prisma schema mirrors these values; a parity test in apps/api guards drift.
 */
const tuple = <T extends string>(...values: [T, ...T[]]) => values;

export const ACCOUNT_TYPES = tuple('APPLICANT', 'VERIFIER', 'INSTITUTION', 'ADMIN');
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_STATUSES = tuple('PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ADMIN_ROLES = tuple('SUPER_ADMIN', 'OPERATIONS', 'REVIEWER', 'FINANCE', 'SUPPORT');
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ORG_ROLES = tuple('OWNER', 'ADMINISTRATOR', 'SUPERVISOR', 'VERIFICATION_OFFICER', 'FINANCE_OFFICER', 'AUDITOR');
export type OrgRole = (typeof ORG_ROLES)[number];

export const ORG_STATUSES = tuple('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');
export type OrgStatus = (typeof ORG_STATUSES)[number];

export const BUSINESS_TYPES = tuple('BANK', 'MICROFINANCE', 'FINTECH', 'INSURANCE', 'TELECOM', 'EMPLOYER', 'PROPERTY', 'GOVERNMENT', 'OTHER');
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const VERIFIER_STATUSES = tuple('INCOMPLETE', 'IDENTITY_PENDING', 'MANUAL_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');
export type VerifierStatus = (typeof VERIFIER_STATUSES)[number];

export const IDENTITY_CHECK_STATUSES = tuple('PENDING', 'PASSED', 'FAILED', 'MANUAL_REVIEW', 'ERROR');
export type IdentityCheckStatus = (typeof IDENTITY_CHECK_STATUSES)[number];

export const REQUEST_STATUSES = tuple(
  'CREATED',
  'AWAITING_APPLICANT',
  'READY_FOR_ASSIGNMENT',
  'DISPATCHING',
  'ASSIGNED',
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'VISIT_IN_PROGRESS',
  'EVIDENCE_SUBMITTED',
  'PROCESSING',
  'MANUAL_REVIEW',
  'COMPLETED',
  'PARTIALLY_VERIFIED',
  'NOT_VERIFIED',
  'INCONCLUSIVE',
  'CANCELLED',
  'EXPIRED',
);
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_SOURCES = tuple('INSTITUTION', 'INDIVIDUAL', 'API', 'BULK');
export type RequestSource = (typeof REQUEST_SOURCES)[number];

export const VERIFICATION_LEVELS = tuple('BASIC', 'STANDARD', 'ENHANCED');
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

export const VERIFICATION_PURPOSES = tuple('BANK_ACCOUNT', 'LOAN', 'EMPLOYMENT', 'TENANCY', 'INSURANCE', 'GOVERNMENT', 'PERSONAL', 'OTHER');
export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number];

export const PRIORITIES = tuple('NORMAL', 'HIGH', 'URGENT');
export type Priority = (typeof PRIORITIES)[number];

export const ASSIGNMENT_STATUSES = tuple('ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'SUBMITTED', 'RELEASED', 'CANCELLED', 'EXPIRED');
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const INVITATION_STATUSES = tuple('SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const APPLICANT_INVITATION_STATUSES = tuple('PENDING', 'OPENED', 'COMPLETED', 'EXPIRED', 'REVOKED');
export type ApplicantInvitationStatus = (typeof APPLICANT_INVITATION_STATUSES)[number];

export const EVIDENCE_CATEGORIES = tuple('BUILDING_EXTERIOR', 'BUILDING_ENTRANCE', 'STREET_ENVIRONMENT', 'ADDITIONAL', 'VIDEO_WALKTHROUGH');
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

export const DOCUMENT_TYPES = tuple('UTILITY_BILL', 'TENANCY_AGREEMENT', 'BANK_STATEMENT', 'GOVERNMENT_LETTER', 'ID_DOCUMENT', 'OTHER');
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const FINDING_KEYS = tuple(
  'BUILDING_EXISTENCE',
  'ADDRESS_MATCH',
  'OCCUPANCY',
  'APPLICANT_PRESENCE',
  'RESIDENCY_CONFIRMATION',
  'CONTACTABILITY',
  'EVIDENCE_INTEGRITY',
);
export type FindingKey = (typeof FINDING_KEYS)[number];

export const FINDING_VALUES = tuple('CONFIRMED', 'NOT_CONFIRMED', 'CONTRADICTED', 'UNABLE_TO_DETERMINE', 'NOT_REQUIRED');
export type FindingValue = (typeof FINDING_VALUES)[number];

export const FINAL_OUTCOMES = tuple('VERIFIED', 'PARTIALLY_VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE', 'MANUAL_REVIEW');
export type FinalOutcome = (typeof FINAL_OUTCOMES)[number];

export const REVIEW_STATUSES = tuple('OPEN', 'IN_PROGRESS', 'RESOLVED');
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const DISPUTE_STATUSES = tuple('OPEN', 'UNDER_REVIEW', 'UPHELD', 'REJECTED');
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const FRAUD_SEVERITIES = tuple('LOW', 'MEDIUM', 'HIGH');
export type FraudSeverity = (typeof FRAUD_SEVERITIES)[number];

export const PAYMENT_STATUSES = tuple('INITIATED', 'SUCCEEDED', 'FAILED', 'ABANDONED', 'REFUNDED');
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_PURPOSES = tuple('INDIVIDUAL_VERIFICATION', 'WALLET_TOPUP');
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export const WALLET_OWNER_TYPES = tuple('VERIFIER', 'ORGANISATION', 'PLATFORM');
export type WalletOwnerType = (typeof WALLET_OWNER_TYPES)[number];

export const LEDGER_BUCKETS = tuple('PENDING', 'AVAILABLE', 'HELD');
export type LedgerBucket = (typeof LEDGER_BUCKETS)[number];

export const PAYOUT_STATUSES = tuple('REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED');
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const NOTIFICATION_CHANNELS = tuple('IN_APP', 'EMAIL', 'SMS', 'PUSH');
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const AI_FEATURES = tuple('ADDRESS_PARSE', 'EVIDENCE_QUALITY', 'OCR', 'REPORT_SUMMARY', 'INSTITUTION_ASSISTANT');
export type AiFeature = (typeof AI_FEATURES)[number];

export const WEBHOOK_EVENTS = tuple(
  'verification.created',
  'verification.status_changed',
  'verification.completed',
  'report.issued',
  'dispute.updated',
);
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const UNAVAILABILITY_FALLBACKS = tuple('DELAYED_ASSIGNMENT', 'ALTERNATIVE_TRANSPORT', 'PROFESSIONAL_AGENT');
export type UnavailabilityFallback = (typeof UNAVAILABILITY_FALLBACKS)[number];
