import { z } from 'zod';
import {
  BUSINESS_TYPES,
  DOCUMENT_TYPES,
  EVIDENCE_CATEGORIES,
  FINAL_OUTCOMES,
  FINDING_KEYS,
  FINDING_VALUES,
  ORG_ROLES,
  PRIORITIES,
  REQUEST_STATUSES,
  UNAVAILABILITY_FALLBACKS,
  VERIFICATION_LEVELS,
  VERIFICATION_PURPOSES,
  WEBHOOK_EVENTS,
  ADMIN_ROLES,
  FRAUD_SEVERITIES,
} from './enums';

// ─── primitives ──────────────────────────────────────────────────────────────
const trimmed = (max = 200) => z.string().trim().min(1).max(max);
const optionalTrimmed = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));
export const phoneSchema = z.string().trim().min(7).max(20).regex(/^[+\d\s()-]+$/, 'Invalid phone number');
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/\d/, 'Include a number');
export const latitudeSchema = z.number().finite().min(-90).max(90);
export const longitudeSchema = z.number().finite().min(-180).max(180);
export const coordinateSchema = z
  .object({ lat: latitudeSchema, lng: longitudeSchema })
  .refine((c) => !(c.lat === 0 && c.lng === 0), 'Coordinates (0,0) are not a valid property location');
export const uuidSchema = z.string().uuid();
export const moneySchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), 'Invalid amount');
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── auth ────────────────────────────────────────────────────────────────────
export const APP_AUDIENCES = ['applicant', 'verifier', 'business', 'admin'] as const;
export type AppAudience = (typeof APP_AUDIENCES)[number];

export const otpRequestSchema = z.object({
  phone: phoneSchema,
  purpose: z.enum(['LOGIN', 'REGISTER', 'RECOVERY', 'VERIFY_PHONE']).default('LOGIN'),
});
export const otpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  purpose: z.enum(['LOGIN', 'REGISTER', 'RECOVERY', 'VERIFY_PHONE']).default('LOGIN'),
  fullName: optionalTrimmed(120),
  email: emailSchema.optional(),
});
export const passwordLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  totp: z.string().regex(/^\d{6}$/).optional(),
});
export const applicantEmailRegisterSchema = z.object({
  fullName: trimmed(120),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
});
export const passwordResetRequestSchema = z.object({ email: emailSchema });
export const passwordResetSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export const mfaVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/) });

// ─── addresses ───────────────────────────────────────────────────────────────
export const addressInputSchema = z.object({
  countryCode: z.string().length(2).toUpperCase().default('NG'),
  state: trimmed(80),
  lga: optionalTrimmed(80),
  city: trimmed(80),
  district: optionalTrimmed(120),
  street: trimmed(160),
  houseNumber: optionalTrimmed(30),
  estate: optionalTrimmed(120),
  landmark: optionalTrimmed(160),
  directions: optionalTrimmed(500),
  lat: latitudeSchema,
  lng: longitudeSchema,
  locationSource: z.enum(['MAP_PIN', 'DEVICE_GPS', 'GEOCODER']).default('MAP_PIN'),
  gpsAccuracyM: z.number().nonnegative().max(100000).optional(),
});
export type AddressInput = z.infer<typeof addressInputSchema>;

// ─── verification policies (spec C9) ─────────────────────────────────────────
export const policyRulesSchema = z.object({
  applicantPresenceRequired: z.boolean().default(false),
  residencyConfirmationRequired: z.boolean().default(true),
  requiredEvidence: z.array(z.enum(EVIDENCE_CATEGORIES)).min(1).default(['BUILDING_EXTERIOR', 'BUILDING_ENTRANCE', 'STREET_ENVIRONMENT']),
  verifierCount: z.number().int().min(1).max(3).default(1),
  mandatoryVideo: z.boolean().default(false),
  manualReviewRiskThreshold: z.number().int().min(0).max(100).default(60),
  reportFreshnessDays: z.number().int().min(1).max(365).default(90),
  completionDeadlineHours: z.number().int().min(4).max(24 * 30).default(72),
  supportingDocumentRequired: z.boolean().default(false),
});
export type PolicyRules = z.infer<typeof policyRulesSchema>;
export const DEFAULT_POLICY_RULES: PolicyRules = policyRulesSchema.parse({});

export const policyCreateSchema = z.object({
  name: trimmed(80),
  description: optionalTrimmed(500),
  level: z.enum(VERIFICATION_LEVELS).default('STANDARD'),
  rules: policyRulesSchema,
});
export const policyVersionSchema = z.object({ rules: policyRulesSchema, changeNote: optionalTrimmed(300) });

// ─── institution requests (spec C5) ──────────────────────────────────────────
export const institutionRequestSchema = z.object({
  applicantName: trimmed(120),
  applicantPhone: phoneSchema,
  applicantEmail: emailSchema.optional().or(z.literal('').transform(() => undefined)),
  customerReference: trimmed(80),
  address: addressInputSchema.partial({ lat: true, lng: true, state: true, city: true, street: true }).optional(),
  level: z.enum(VERIFICATION_LEVELS).default('STANDARD'),
  policyId: uuidSchema.optional(),
  purpose: z.enum(VERIFICATION_PURPOSES).default('BANK_ACCOUNT'),
  priority: z.enum(PRIORITIES).default('NORMAL'),
  deadline: z.coerce.date().optional(),
  instructions: optionalTrimmed(1000),
  department: optionalTrimmed(80),
  sendInvitation: z.boolean().default(true),
});
export type InstitutionRequestInput = z.infer<typeof institutionRequestSchema>;

export const requestFiltersSchema = paginationSchema.extend({
  status: z.enum(REQUEST_STATUSES).optional(),
  level: z.enum(VERIFICATION_LEVELS).optional(),
  q: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  state: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  verifierId: uuidSchema.optional(),
  department: z.string().trim().max(80).optional(),
  risk: z.enum(['flagged', 'clear']).optional(),
});

// ─── applicant submission (spec A4) ──────────────────────────────────────────
export const visitWindowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period: z.enum(['MORNING', 'AFTERNOON', 'EVENING', 'ANY']),
});
export const applicantSubmissionSchema = z.object({
  purpose: z.enum(VERIFICATION_PURPOSES).optional(),
  fullName: trimmed(120),
  email: emailSchema.optional().or(z.literal('').transform(() => undefined)),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  address: addressInputSchema,
  consent: z.object({
    privacyNoticeAccepted: z.literal(true, { errorMap: () => ({ message: 'You must accept the privacy notice' }) }),
    visitAuthorised: z.literal(true, { errorMap: () => ({ message: 'You must authorise the visit' }) }),
    dataSharingAuthorised: z.literal(true, { errorMap: () => ({ message: 'You must authorise sharing the report' }) }),
  }),
  visitWindow: visitWindowSchema.optional(),
});
export type ApplicantSubmissionInput = z.infer<typeof applicantSubmissionSchema>;

export const individualRequestSchema = applicantSubmissionSchema.extend({
  level: z.enum(VERIFICATION_LEVELS).default('STANDARD'),
  purpose: z.enum(VERIFICATION_PURPOSES).default('PERSONAL'),
});

export const documentUploadMetaSchema = z.object({ documentType: z.enum(DOCUMENT_TYPES) });

// ─── organisation onboarding (spec C1) ───────────────────────────────────────
export const organisationRegisterSchema = z.object({
  legalName: trimmed(160),
  tradingName: optionalTrimmed(160),
  registrationNumber: trimmed(40),
  businessType: z.enum(BUSINESS_TYPES),
  countryCode: z.string().length(2).toUpperCase().default('NG'),
  contactEmail: emailSchema,
  contactPhone: phoneSchema,
  address: trimmed(300),
  website: z.string().url().max(200).optional().or(z.literal('').transform(() => undefined)),
  expectedMonthlyVolume: z.coerce.number().int().min(0).max(10_000_000).default(0),
  verificationRequirements: optionalTrimmed(1000),
  representative: z.object({
    fullName: trimmed(120),
    email: emailSchema,
    phone: phoneSchema,
    jobTitle: trimmed(80),
    password: passwordSchema,
  }),
});
export const memberInviteSchema = z.object({ fullName: trimmed(120), email: emailSchema, role: z.enum(ORG_ROLES) });
export const memberRoleSchema = z.object({ role: z.enum(ORG_ROLES) });

// ─── verifier onboarding (spec B1) ───────────────────────────────────────────
export const verifierRegisterSchema = z.object({
  fullName: trimmed(120),
  phone: phoneSchema,
  email: emailSchema,
  password: passwordSchema,
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((d) => {
      const age = (Date.now() - new Date(d).getTime()) / (365.25 * 24 * 3600 * 1000);
      return age >= 18 && age < 100;
    }, 'Verifiers must be at least 18 years old'),
  residentialAddress: trimmed(300),
  homeLat: latitudeSchema.optional(),
  homeLng: longitudeSchema.optional(),
});
export const verifierIdentitySchema = z.object({
  idType: z.enum(['NIN', 'BVN', 'VOTERS_CARD', 'DRIVERS_LICENCE', 'INTL_PASSPORT']),
  idNumber: z.string().trim().min(6).max(20).regex(/^[A-Z0-9]+$/i),
});
export const payoutAccountSchema = z.object({
  bankCode: z.string().trim().min(3).max(10),
  bankName: trimmed(80),
  accountNumber: z.string().regex(/^\d{10}$/, 'Enter a 10-digit NUBAN account number'),
  accountName: trimmed(120),
});
export const availabilitySchema = z.object({
  available: z.boolean(),
  lat: latitudeSchema.optional(),
  lng: longitudeSchema.optional(),
  accuracyM: z.number().nonnegative().max(100000).optional(),
});
export const heartbeatSchema = z.object({
  lat: latitudeSchema,
  lng: longitudeSchema,
  accuracyM: z.number().nonnegative().max(100000),
  recordedAt: z.coerce.date().optional(),
  sessionId: uuidSchema,
});

// ─── field visit (spec B8–B13) ───────────────────────────────────────────────
export const gpsFixSchema = z.object({
  lat: latitudeSchema,
  lng: longitudeSchema,
  accuracyM: z.number().nonnegative().max(100000),
  capturedAt: z.coerce.date().optional(),
  isMocked: z.boolean().optional(),
});
export const arrivalSchema = gpsFixSchema.extend({
  exception: z.enum(['NONE', 'POOR_GPS', 'PROPERTY_INACCESSIBLE', 'ADDRESS_NOT_FOUND']).default('NONE'),
  exceptionNote: optionalTrimmed(500),
});
export const triState = z.enum(['YES', 'NO', 'UNKNOWN']);
export const checklistSchema = z.object({
  applicantAvailable: triState,
  applicantConfirmedResidence: triState,
  occupantConfirmedResidence: triState,
  anyoneAvailable: triState,
  contactRefused: triState,
  propertyAccessible: triState,
  addressMatchesDescription: z.enum(['YES', 'PARTIAL', 'NO', 'UNKNOWN']),
  buildingExists: z.enum(['YES', 'NO', 'UNKNOWN']),
  buildingType: z.enum(['DETACHED', 'SEMI_DETACHED', 'BLOCK_OF_FLATS', 'COMPOUND', 'COMMERCIAL', 'MIXED_USE', 'UNDER_CONSTRUCTION', 'VACANT_LAND', 'OTHER']).optional(),
  occupancySigns: z.enum(['OCCUPIED', 'APPEARS_VACANT', 'UNKNOWN']),
  houseNumberVisible: z.boolean().default(false),
  observations: optionalTrimmed(2000),
});
export type ChecklistInput = z.infer<typeof checklistSchema>;
export const draftSchema = z.object({ checklist: checklistSchema.partial(), clientUpdatedAt: z.coerce.date() });
export const confirmationCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export const visitSubmitSchema = z.object({ checklist: checklistSchema, idempotencyKey: z.string().min(8).max(100) });
export const incidentSchema = z.object({
  kind: z.enum(['ASSISTANCE', 'UNSAFE_CONDITIONS']),
  message: trimmed(1000),
  lat: latitudeSchema.optional(),
  lng: longitudeSchema.optional(),
});
export const evidenceMetaSchema = z.object({
  category: z.enum(EVIDENCE_CATEGORIES),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  accuracyM: z.coerce.number().nonnegative().max(100000),
  capturedAt: z.coerce.date(),
  deviceId: z.string().trim().min(4).max(100),
  captureSource: z.literal('CAMERA', { errorMap: () => ({ message: 'Primary evidence must be captured with the camera' }) }),
  clientSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  originalSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  compressed: z.coerce.boolean().optional(),
});

// ─── reviews, disputes, admin ────────────────────────────────────────────────
export const disputeSchema = z.object({ reason: trimmed(80), details: trimmed(2000) });
export const disputeResolveSchema = z.object({ decision: z.enum(['UPHELD', 'REJECTED']), resolutionNote: trimmed(2000) });
export const findingOverrideSchema = z.object({ key: z.enum(FINDING_KEYS), value: z.enum(FINDING_VALUES), note: trimmed(500) });
export const reviewResolveSchema = z.object({
  outcome: z.enum(FINAL_OUTCOMES).refine((o) => o !== 'MANUAL_REVIEW', 'Choose a final outcome'),
  findingOverrides: z.array(findingOverrideSchema).max(7).default([]),
  note: trimmed(2000),
  requestRevisit: z.boolean().default(false),
});
export const reviewerNoteSchema = z.object({ note: trimmed(2000) });
export const verifierDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'SUSPEND', 'REINSTATE']),
  reason: trimmed(500),
});
export const userStatusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: trimmed(500) });
export const orgDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'SUSPEND', 'REINSTATE']),
  reason: trimmed(500),
  postpaidCreditLimit: moneySchema.optional(),
});
export const manualAssignSchema = z.object({ verifierId: uuidSchema, reason: trimmed(500) });
export const cancelSchema = z.object({ reason: trimmed(500) });
export const fraudResolveSchema = z.object({ resolution: z.enum(['CONFIRMED_FRAUD', 'FALSE_POSITIVE']), note: trimmed(1000) });
export const fraudSeveritySchema = z.enum(FRAUD_SEVERITIES);
export const adminCreateSchema = z.object({ fullName: trimmed(120), email: emailSchema, role: z.enum(ADMIN_ROLES), password: passwordSchema });
export const privilegedConfirmSchema = z.object({ confirmPassword: z.string().min(1).max(128) });

export const platformConfigSchema = z.object({
  arrivalThresholdM: z.number().int().min(10).max(500),
  heartbeatExpirySeconds: z.number().int().min(30).max(3600),
  assignmentOfferSeconds: z.number().int().min(30).max(3600),
  walkingTiersMinutes: z.array(z.number().int().min(1).max(180)).min(1).max(8),
  invitationsPerTier: z.number().int().min(1).max(20),
  maxGpsAccuracyM: z.number().int().min(5).max(500),
  verifierRewardShare: z.number().min(0).max(1),
  earningsHoldHours: z.number().int().min(0).max(24 * 30),
  minimumPayout: z.number().min(0),
  locationRetentionDays: z.number().int().min(1).max(365),
  unavailabilityFallbacks: z.array(z.enum(UNAVAILABILITY_FALLBACKS)),
});
export type PlatformConfig = z.infer<typeof platformConfigSchema>;
export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  arrivalThresholdM: 50,
  heartbeatExpirySeconds: 180,
  assignmentOfferSeconds: 300,
  walkingTiersMinutes: [15, 20, 30, 45],
  invitationsPerTier: 3,
  maxGpsAccuracyM: 50,
  verifierRewardShare: 0.4,
  earningsHoldHours: 0,
  minimumPayout: 1000,
  locationRetentionDays: 30,
  unavailabilityFallbacks: ['DELAYED_ASSIGNMENT', 'ALTERNATIVE_TRANSPORT', 'PROFESSIONAL_AGENT'],
};

export const pricingPlanSchema = z.object({
  countryCode: z.string().length(2).toUpperCase(),
  level: z.enum(VERIFICATION_LEVELS),
  audience: z.enum(['INDIVIDUAL', 'INSTITUTION']),
  price: moneySchema,
  verifierReward: moneySchema,
  bulkThreshold: z.number().int().min(0).default(0),
  bulkPrice: moneySchema.optional(),
  slaHours: z.number().int().min(1).max(24 * 30),
  active: z.boolean().default(true),
});

export const countrySchema = z.object({
  code: z.string().length(2).toUpperCase(),
  name: trimmed(80),
  currency: z.string().length(3).toUpperCase(),
  timezone: trimmed(60),
  phonePrefix: z.string().regex(/^\+\d{1,4}$/),
  active: z.boolean().default(true),
});
export const areaSchema = z.object({
  countryCode: z.string().length(2).toUpperCase(),
  type: z.enum(['STATE', 'LGA', 'CITY']),
  name: trimmed(80),
  parentId: uuidSchema.optional(),
  serviceActive: z.boolean().default(true),
  maxWalkingMinutes: z.number().int().min(5).max(180).optional(),
  centerLat: latitudeSchema.optional(),
  centerLng: longitudeSchema.optional(),
});

export const aiConfigSchema = z.object({
  enabled: z.boolean(),
  features: z.record(z.enum(['ADDRESS_PARSE', 'EVIDENCE_QUALITY', 'OCR', 'REPORT_SUMMARY', 'INSTITUTION_ASSISTANT']), z.object({ enabled: z.boolean(), model: z.string().min(1).max(80) })),
  monthlyBudgetUsd: z.number().min(0).max(100000),
  maxImagesPerVisit: z.number().int().min(0).max(20),
  riskReviewThreshold: z.number().int().min(0).max(100),
});

// ─── billing, payouts, API ───────────────────────────────────────────────────
export const topUpSchema = z.object({ amount: moneySchema.refine((v) => Number(v) >= 1000, 'Minimum top-up is 1,000') });
export const payoutRequestSchema = z.object({ amount: moneySchema, idempotencyKey: z.string().min(8).max(100) });
export const payoutDecisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: trimmed(500), confirmPassword: z.string().min(1).max(128) });
export const refundSchema = z.object({ reason: trimmed(500), confirmPassword: z.string().min(1).max(128) });
export const apiKeyCreateSchema = z.object({ name: trimmed(80), scopes: z.array(z.enum(['requests:write', 'requests:read', 'reports:read'])).min(1) });
export const webhookCreateSchema = z.object({
  url: z.string().url().max(500).refine((u) => u.startsWith('https://') || u.startsWith('http://localhost') || u.startsWith('http://127.0.0.1'), 'Webhook URLs must use HTTPS'),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  description: optionalTrimmed(200),
});
export const assistantQuerySchema = z.object({ question: trimmed(500) });
export const dataSubjectRequestSchema = z.object({ kind: z.enum(['ACCESS', 'DELETION', 'CORRECTION']), details: optionalTrimmed(1000) });
