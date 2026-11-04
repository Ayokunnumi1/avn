-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('APPLICANT', 'VERIFIER', 'INSTITUTION', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'OPERATIONS', 'REVIEWER', 'FINANCE', 'SUPPORT');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMINISTRATOR', 'SUPERVISOR', 'VERIFICATION_OFFICER', 'FINANCE_OFFICER', 'AUDITOR');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('BANK', 'MICROFINANCE', 'FINTECH', 'INSURANCE', 'TELECOM', 'EMPLOYER', 'PROPERTY', 'GOVERNMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "VerifierStatus" AS ENUM ('INCOMPLETE', 'IDENTITY_PENDING', 'MANUAL_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "IdentityCheckStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'MANUAL_REVIEW', 'ERROR');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('CREATED', 'AWAITING_APPLICANT', 'READY_FOR_ASSIGNMENT', 'DISPATCHING', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'VISIT_IN_PROGRESS', 'EVIDENCE_SUBMITTED', 'PROCESSING', 'MANUAL_REVIEW', 'COMPLETED', 'PARTIALLY_VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RequestSource" AS ENUM ('INSTITUTION', 'INDIVIDUAL', 'API', 'BULK');

-- CreateEnum
CREATE TYPE "VerificationLevel" AS ENUM ('BASIC', 'STANDARD', 'ENHANCED');

-- CreateEnum
CREATE TYPE "VerificationPurpose" AS ENUM ('BANK_ACCOUNT', 'LOAN', 'EMPLOYMENT', 'TENANCY', 'INSURANCE', 'GOVERNMENT', 'PERSONAL', 'OTHER');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'SUBMITTED', 'RELEASED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ApplicantInvitationStatus" AS ENUM ('PENDING', 'OPENED', 'COMPLETED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "EvidenceCategory" AS ENUM ('BUILDING_EXTERIOR', 'BUILDING_ENTRANCE', 'STREET_ENVIRONMENT', 'ADDITIONAL', 'VIDEO_WALKTHROUGH');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('UTILITY_BILL', 'TENANCY_AGREEMENT', 'BANK_STATEMENT', 'GOVERNMENT_LETTER', 'ID_DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "FindingKey" AS ENUM ('BUILDING_EXISTENCE', 'ADDRESS_MATCH', 'OCCUPANCY', 'APPLICANT_PRESENCE', 'RESIDENCY_CONFIRMATION', 'CONTACTABILITY', 'EVIDENCE_INTEGRITY');

-- CreateEnum
CREATE TYPE "FindingValue" AS ENUM ('CONFIRMED', 'NOT_CONFIRMED', 'CONTRADICTED', 'UNABLE_TO_DETERMINE', 'NOT_REQUIRED');

-- CreateEnum
CREATE TYPE "FinalOutcome" AS ENUM ('VERIFIED', 'PARTIALLY_VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'UPHELD', 'REJECTED');

-- CreateEnum
CREATE TYPE "FraudSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "FraudSignalStatus" AS ENUM ('OPEN', 'CONFIRMED_FRAUD', 'FALSE_POSITIVE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'SUCCEEDED', 'FAILED', 'ABANDONED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('INDIVIDUAL_VERIFICATION', 'WALLET_TOPUP');

-- CreateEnum
CREATE TYPE "WalletOwnerType" AS ENUM ('VERIFIER', 'ORGANISATION', 'PLATFORM');

-- CreateEnum
CREATE TYPE "LedgerBucket" AS ENUM ('PENDING', 'AVAILABLE', 'HELD');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "LedgerCategory" AS ENUM ('VERIFICATION_EARNING', 'EARNING_RELEASE', 'PAYOUT_HOLD', 'PAYOUT_COMPLETE', 'PAYOUT_REVERSAL', 'TOPUP', 'VERIFICATION_CHARGE', 'VERIFICATION_REFUND', 'PLATFORM_FEE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'PUSH');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('ADDRESS_PARSE', 'EVIDENCE_QUALITY', 'OCR', 'REPORT_SUMMARY', 'INSTITUTION_ASSISTANT');

-- CreateEnum
CREATE TYPE "AiAnalysisStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "BulkUploadStatus" AS ENUM ('VALIDATED', 'PROCESSING', 'COMPLETED', 'FAILED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "FileScanStatus" AS ENUM ('NOT_SCANNED', 'CLEAN', 'INFECTED');

-- CreateEnum
CREATE TYPE "AreaType" AS ENUM ('STATE', 'LGA', 'CITY');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "accountType" "AccountType" NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "isGuest" BOOLEAN NOT NULL DEFAULT false,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "passwordHash" TEXT,
    "mfaSecretEnc" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "adminRole" "AdminRole",
    "countryCode" TEXT NOT NULL DEFAULT 'NG',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "notificationPrefs" JSONB NOT NULL DEFAULT '{"email":true,"sms":true,"push":true}',
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "scopeRequestId" UUID,
    "mfaVerified" BOOLEAN NOT NULL DEFAULT false,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" UUID NOT NULL,
    "destination" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicantProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "dateOfBirth" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicantProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerifierProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "VerifierStatus" NOT NULL DEFAULT 'INCOMPLETE',
    "dateOfBirth" TEXT NOT NULL,
    "residentialAddress" TEXT NOT NULL,
    "homeLat" DOUBLE PRECISION,
    "homeLng" DOUBLE PRECISION,
    "photoFileId" UUID,
    "idType" TEXT,
    "idNumberEnc" TEXT,
    "idNumberLast4" TEXT,
    "payoutBankCode" TEXT,
    "payoutBankName" TEXT,
    "payoutAccountEnc" TEXT,
    "payoutAccountLast4" TEXT,
    "payoutAccountName" TEXT,
    "payoutRecipientCode" TEXT,
    "reliabilityScore" DECIMAL(5,2) NOT NULL DEFAULT 80,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "onTimeCount" INTEGER NOT NULL DEFAULT 0,
    "auditPassCount" INTEGER NOT NULL DEFAULT 0,
    "auditFailCount" INTEGER NOT NULL DEFAULT 0,
    "evidenceQualityAvg" DECIMAL(5,2),
    "approvedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "decisionReason" TEXT,
    "isProfessional" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerifierProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerifierIdentityCheck" (
    "id" UUID NOT NULL,
    "verifierId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "idType" TEXT NOT NULL,
    "status" "IdentityCheckStatus" NOT NULL DEFAULT 'PENDING',
    "providerReference" TEXT,
    "resultSummary" JSONB,
    "idDocumentFileId" UUID,
    "selfieFileId" UUID,
    "reviewedById" UUID,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "VerifierIdentityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organisation" (
    "id" UUID NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradingName" TEXT,
    "registrationNumber" TEXT NOT NULL,
    "businessType" "BusinessType" NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT 'NG',
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "website" TEXT,
    "expectedMonthlyVolume" INTEGER NOT NULL DEFAULT 0,
    "verificationRequirements" TEXT,
    "status" "OrgStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "postpaidEnabled" BOOLEAN NOT NULL DEFAULT false,
    "creditLimit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "decisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganisationRole" (
    "key" "OrgRole" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "permissions" TEXT[],

    CONSTRAINT "OrganisationRole_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "OrganisationMember" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "OrgRole" NOT NULL,
    "jobTitle" TEXT,
    "department" TEXT,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganisationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Country" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "phonePrefix" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "AdministrativeArea" (
    "id" UUID NOT NULL,
    "countryCode" TEXT NOT NULL,
    "type" "AreaType" NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" UUID,
    "serviceActive" BOOLEAN NOT NULL DEFAULT true,
    "maxWalkingMinutes" INTEGER,
    "centerLat" DOUBLE PRECISION,
    "centerLng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdministrativeArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID,
    "organisationId" UUID,
    "countryCode" TEXT NOT NULL DEFAULT 'NG',
    "state" TEXT NOT NULL,
    "lga" TEXT,
    "city" TEXT NOT NULL,
    "district" TEXT,
    "street" TEXT NOT NULL,
    "houseNumber" TEXT,
    "estate" TEXT,
    "landmark" TEXT,
    "directions" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "location" geography(Point,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)::geography) STORED,
    "locationSource" TEXT NOT NULL DEFAULT 'MAP_PIN',
    "gpsAccuracyM" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationPolicy" (
    "id" UUID NOT NULL,
    "organisationId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "level" "VerificationLevel" NOT NULL DEFAULT 'STANDARD',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationPolicyVersion" (
    "id" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "changeNote" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationPolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationRequest" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "organisationId" UUID,
    "applicantUserId" UUID,
    "createdByUserId" UUID,
    "apiCredentialId" UUID,
    "bulkUploadId" UUID,
    "source" "RequestSource" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'CREATED',
    "level" "VerificationLevel" NOT NULL DEFAULT 'STANDARD',
    "purpose" "VerificationPurpose" NOT NULL DEFAULT 'BANK_ACCOUNT',
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "customerReference" TEXT,
    "department" TEXT,
    "applicantName" TEXT NOT NULL,
    "applicantPhone" TEXT NOT NULL,
    "applicantEmail" TEXT,
    "applicantDob" TEXT,
    "addressId" UUID,
    "lockedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "policyVersionId" UUID,
    "policySnapshot" JSONB NOT NULL,
    "instructions" TEXT,
    "deadline" TIMESTAMP(3),
    "price" DECIMAL(14,2) NOT NULL,
    "verifierReward" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "chargedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "visitWindow" JSONB,
    "consent" JSONB,
    "consentAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "dispatchTier" INTEGER NOT NULL DEFAULT 0,
    "dispatchStartedAt" TIMESTAMP(3),
    "lastDispatchAt" TIMESTAMP(3),
    "coverageFallback" TEXT,
    "outcome" "FinalOutcome",
    "outcomeAt" TIMESTAMP(3),
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "riskFlagged" BOOLEAN NOT NULL DEFAULT false,
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "VerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestStatusEvent" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "fromStatus" "RequestStatus",
    "toStatus" "RequestStatus" NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicantInvitation" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "status" "ApplicantInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sendCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicantInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "originalName" TEXT,
    "ownerUserId" UUID,
    "organisationId" UUID,
    "scanStatus" "FileScanStatus" NOT NULL DEFAULT 'NOT_SCANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicantDocument" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "fileId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicantDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerifierAvailability" (
    "id" UUID NOT NULL,
    "verifierId" UUID NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT false,
    "sessionId" UUID,
    "startedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastLat" DOUBLE PRECISION,
    "lastLng" DOUBLE PRECISION,
    "lastAccuracyM" DOUBLE PRECISION,
    "location" geography(Point,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint("lastLng", "lastLat"), 4326)::geography) STORED,
    "endedReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerifierAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerifierLocation" (
    "id" UUID NOT NULL,
    "verifierId" UUID NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "location" geography(Point,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)::geography) STORED,
    "accuracyM" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availabilityState" BOOLEAN NOT NULL,
    "sessionId" UUID,

    CONSTRAINT "VerifierLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentInvitation" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "verifierId" UUID NOT NULL,
    "tier" INTEGER NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'SENT',
    "distanceM" INTEGER NOT NULL,
    "walkingMinutes" DECIMAL(6,1) NOT NULL,
    "routingSource" TEXT NOT NULL,
    "reward" DECIMAL(14,2) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationAssignment" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "verifierId" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACCEPTED',
    "invitationId" UUID,
    "assignedById" UUID,
    "idempotencyKey" TEXT,
    "reward" DECIMAL(14,2) NOT NULL,
    "distanceM" INTEGER,
    "walkingMinutes" DECIMAL(6,1),
    "routingSource" TEXT,
    "deadline" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enRouteAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldVisit" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "verifierId" UUID NOT NULL,
    "arrivalLat" DOUBLE PRECISION,
    "arrivalLng" DOUBLE PRECISION,
    "arrivalAccuracyM" DOUBLE PRECISION,
    "arrivalAt" TIMESTAMP(3),
    "arrivalClientAt" TIMESTAMP(3),
    "distanceFromTargetM" INTEGER,
    "thresholdM" INTEGER,
    "withinThreshold" BOOLEAN,
    "arrivalException" TEXT,
    "exceptionNote" TEXT,
    "integritySignals" JSONB,
    "checklist" JSONB,
    "draft" JSONB,
    "draftUpdatedAt" TIMESTAMP(3),
    "confirmationCodeHash" TEXT,
    "confirmationExpiresAt" TIMESTAMP(3),
    "confirmationAttempts" INTEGER NOT NULL DEFAULT 0,
    "applicantConfirmedAt" TIMESTAMP(3),
    "confirmationMethod" TEXT,
    "incidents" JSONB NOT NULL DEFAULT '[]',
    "submissionKey" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationEvidence" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "verifierId" UUID NOT NULL,
    "category" "EvidenceCategory" NOT NULL,
    "fileId" UUID NOT NULL,
    "serverSha256" TEXT NOT NULL,
    "originalSha256" TEXT,
    "perceptualHash" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "compressed" BOOLEAN NOT NULL DEFAULT false,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracyM" DOUBLE PRECISION NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT NOT NULL,
    "captureSource" TEXT NOT NULL,
    "distanceFromTargetM" INTEGER,
    "duplicateOfId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationFinding" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "key" "FindingKey" NOT NULL,
    "value" "FindingValue" NOT NULL,
    "source" TEXT NOT NULL,
    "basis" JSONB NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationReport" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "outcome" "FinalOutcome" NOT NULL,
    "findingsSnapshot" JSONB NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "aiAssisted" BOOLEAN NOT NULL DEFAULT false,
    "contentHash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "fileId" UUID,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "VerificationReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationDispute" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "reportId" UUID,
    "raisedByUserId" UUID NOT NULL,
    "raisedByType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionNote" TEXT,
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualReview" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'OPEN',
    "trigger" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "assignedToId" UUID,
    "notes" JSONB NOT NULL DEFAULT '[]',
    "outcome" "FinalOutcome",
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudSignal" (
    "id" UUID NOT NULL,
    "requestId" UUID,
    "verifierId" UUID,
    "evidenceId" UUID,
    "rule" TEXT NOT NULL,
    "severity" "FraudSeverity" NOT NULL,
    "score" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "data" JSONB,
    "source" TEXT NOT NULL DEFAULT 'RULE',
    "status" "FraudSignalStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" UUID,
    "resolvedNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "actorType" TEXT NOT NULL,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "organisationId" UUID,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "userId" UUID,
    "organisationId" UUID,
    "requestId" UUID,
    "authorizationUrl" TEXT,
    "providerReference" TEXT,
    "channel" TEXT,
    "paidAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "verification" JSONB,
    "refundedAt" TIMESTAMP(3),
    "refundReason" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureOk" BOOLEAN NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" UUID NOT NULL,
    "ownerType" "WalletOwnerType" NOT NULL,
    "verifierId" UUID,
    "organisationId" UUID,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "pendingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "availableBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "heldBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "bucket" "LedgerBucket" NOT NULL,
    "category" "LedgerCategory" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "balanceAfter" DECIMAL(14,2) NOT NULL,
    "reference" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requestId" UUID,
    "paymentId" UUID,
    "payoutId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "verifierId" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "PayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "bankName" TEXT NOT NULL,
    "accountLast4" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingPlan" (
    "id" UUID NOT NULL,
    "countryCode" TEXT NOT NULL,
    "level" "VerificationLevel" NOT NULL,
    "audience" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "verifierReward" DECIMAL(14,2) NOT NULL,
    "bulkThreshold" INTEGER NOT NULL DEFAULT 0,
    "bulkPrice" DECIMAL(14,2),
    "slaHours" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "total" DECIMAL(14,2) NOT NULL,
    "lineItems" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" UUID NOT NULL,
    "notificationId" UUID,
    "userId" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "destination" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiCredential" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "rotatedFromId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiRequestLog" (
    "id" UUID NOT NULL,
    "credentialId" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookSubscription" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "events" TEXT[],
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkUpload" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "BulkUploadStatus" NOT NULL DEFAULT 'VALIDATED',
    "totalRows" INTEGER NOT NULL,
    "validRows" INTEGER NOT NULL,
    "invalidRows" INTEGER NOT NULL,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "rows" JSONB NOT NULL,
    "errors" JSONB NOT NULL,
    "options" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BulkUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAnalysis" (
    "id" UUID NOT NULL,
    "feature" "AiFeature" NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "requestId" UUID,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" "AiAnalysisStatus" NOT NULL,
    "findings" JSONB,
    "confidence" DOUBLE PRECISION,
    "explanation" TEXT,
    "nextAction" TEXT,
    "error" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageRecord" (
    "id" UUID NOT NULL,
    "feature" "AiFeature" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "images" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "organisationId" UUID,
    "succeeded" BOOLEAN NOT NULL,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "requestId" UUID,
    "kind" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "textVersion" TEXT NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSubjectRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "User_accountType_email_key" ON "User"("accountType", "email");

-- CreateIndex
CREATE UNIQUE INDEX "User_accountType_phone_key" ON "User"("accountType", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");

-- CreateIndex
CREATE INDEX "UserSession_userId_revokedAt_idx" ON "UserSession"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "OtpChallenge_destination_purpose_createdAt_idx" ON "OtpChallenge"("destination", "purpose", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicantProfile_userId_key" ON "ApplicantProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerifierProfile_userId_key" ON "VerifierProfile"("userId");

-- CreateIndex
CREATE INDEX "VerifierProfile_status_idx" ON "VerifierProfile"("status");

-- CreateIndex
CREATE INDEX "VerifierIdentityCheck_verifierId_createdAt_idx" ON "VerifierIdentityCheck"("verifierId", "createdAt");

-- CreateIndex
CREATE INDEX "Organisation_status_idx" ON "Organisation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_countryCode_registrationNumber_key" ON "Organisation"("countryCode", "registrationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationMember_userId_key" ON "OrganisationMember"("userId");

-- CreateIndex
CREATE INDEX "OrganisationMember_organisationId_role_idx" ON "OrganisationMember"("organisationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "AdministrativeArea_countryCode_type_name_parentId_key" ON "AdministrativeArea"("countryCode", "type", "name", "parentId");

-- CreateIndex
CREATE INDEX "Address_state_city_idx" ON "Address"("state", "city");

-- CreateIndex
CREATE INDEX "VerificationPolicy_organisationId_idx" ON "VerificationPolicy"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationPolicyVersion_policyId_version_key" ON "VerificationPolicyVersion"("policyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationRequest_reference_key" ON "VerificationRequest"("reference");

-- CreateIndex
CREATE INDEX "VerificationRequest_organisationId_status_createdAt_idx" ON "VerificationRequest"("organisationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationRequest_organisationId_customerReference_idx" ON "VerificationRequest"("organisationId", "customerReference");

-- CreateIndex
CREATE INDEX "VerificationRequest_applicantUserId_createdAt_idx" ON "VerificationRequest"("applicantUserId", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationRequest_status_updatedAt_idx" ON "VerificationRequest"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "RequestStatusEvent_requestId_createdAt_idx" ON "RequestStatusEvent"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicantInvitation_requestId_key" ON "ApplicantInvitation"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicantInvitation_tokenHash_key" ON "ApplicantInvitation"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_storageKey_key" ON "StoredFile"("storageKey");

-- CreateIndex
CREATE INDEX "StoredFile_sha256_idx" ON "StoredFile"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "VerifierAvailability_verifierId_key" ON "VerifierAvailability"("verifierId");

-- CreateIndex
CREATE INDEX "VerifierLocation_verifierId_receivedAt_idx" ON "VerifierLocation"("verifierId", "receivedAt");

-- CreateIndex
CREATE INDEX "AssignmentInvitation_verifierId_status_expiresAt_idx" ON "AssignmentInvitation"("verifierId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentInvitation_requestId_verifierId_key" ON "AssignmentInvitation"("requestId", "verifierId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationAssignment_invitationId_key" ON "VerificationAssignment"("invitationId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationAssignment_idempotencyKey_key" ON "VerificationAssignment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "VerificationAssignment_verifierId_status_idx" ON "VerificationAssignment"("verifierId", "status");

-- CreateIndex
CREATE INDEX "VerificationAssignment_requestId_idx" ON "VerificationAssignment"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "FieldVisit_assignmentId_key" ON "FieldVisit"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "FieldVisit_submissionKey_key" ON "FieldVisit"("submissionKey");

-- CreateIndex
CREATE INDEX "FieldVisit_requestId_idx" ON "FieldVisit"("requestId");

-- CreateIndex
CREATE INDEX "VerificationEvidence_requestId_idx" ON "VerificationEvidence"("requestId");

-- CreateIndex
CREATE INDEX "VerificationEvidence_serverSha256_idx" ON "VerificationEvidence"("serverSha256");

-- CreateIndex
CREATE INDEX "VerificationEvidence_perceptualHash_idx" ON "VerificationEvidence"("perceptualHash");

-- CreateIndex
CREATE INDEX "VerificationFinding_requestId_key_idx" ON "VerificationFinding"("requestId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationReport_reference_key" ON "VerificationReport"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationReport_requestId_version_key" ON "VerificationReport"("requestId", "version");

-- CreateIndex
CREATE INDEX "VerificationDispute_status_idx" ON "VerificationDispute"("status");

-- CreateIndex
CREATE INDEX "ManualReview_status_createdAt_idx" ON "ManualReview"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FraudSignal_status_severity_idx" ON "FraudSignal"("status", "severity");

-- CreateIndex
CREATE INDEX "FraudSignal_requestId_idx" ON "FraudSignal"("requestId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_organisationId_createdAt_idx" ON "AuditEvent"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_createdAt_idx" ON "AuditEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_provider_eventKey_key" ON "PaymentWebhookEvent"("provider", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_verifierId_key" ON "Wallet"("verifierId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_organisationId_key" ON "Wallet"("organisationId");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "WalletTransaction"("walletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_walletId_reference_bucket_direction_key" ON "WalletTransaction"("walletId", "reference", "bucket", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_reference_key" ON "Payout"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_idempotencyKey_key" ON "Payout"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payout_status_createdAt_idx" ON "Payout"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PricingPlan_countryCode_level_audience_key" ON "PricingPlan"("countryCode", "level", "audience");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_organisationId_periodStart_key" ON "Invoice"("organisationId", "periodStart");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_createdAt_idx" ON "NotificationDelivery"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_key_channel_key" ON "NotificationTemplate"("key", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "ApiCredential_keyPrefix_key" ON "ApiCredential"("keyPrefix");

-- CreateIndex
CREATE INDEX "ApiCredential_organisationId_idx" ON "ApiCredential"("organisationId");

-- CreateIndex
CREATE INDEX "ApiRequestLog_organisationId_createdAt_idx" ON "ApiRequestLog"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_subscriptionId_createdAt_idx" ON "WebhookDelivery"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AiAnalysis_subjectType_subjectId_idx" ON "AiAnalysis"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "AiAnalysis_requestId_idx" ON "AiAnalysis"("requestId");

-- CreateIndex
CREATE INDEX "AiUsageRecord_createdAt_idx" ON "AiUsageRecord"("createdAt");

-- CreateIndex
CREATE INDEX "ConsentRecord_requestId_idx" ON "ConsentRecord"("requestId");

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantProfile" ADD CONSTRAINT "ApplicantProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifierProfile" ADD CONSTRAINT "VerifierProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifierIdentityCheck" ADD CONSTRAINT "VerifierIdentityCheck_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "VerifierProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationMember" ADD CONSTRAINT "OrganisationMember_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationMember" ADD CONSTRAINT "OrganisationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdministrativeArea" ADD CONSTRAINT "AdministrativeArea_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "Country"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdministrativeArea" ADD CONSTRAINT "AdministrativeArea_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AdministrativeArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationPolicy" ADD CONSTRAINT "VerificationPolicy_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationPolicyVersion" ADD CONSTRAINT "VerificationPolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "VerificationPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_applicantUserId_fkey" FOREIGN KEY ("applicantUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "VerificationPolicyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestStatusEvent" ADD CONSTRAINT "RequestStatusEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "VerificationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantInvitation" ADD CONSTRAINT "ApplicantInvitation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "VerificationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantDocument" ADD CONSTRAINT "ApplicantDocument_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "VerificationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifierAvailability" ADD CONSTRAINT "VerifierAvailability_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "VerifierProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifierLocation" ADD CONSTRAINT "VerifierLocation_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "VerifierProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentInvitation" ADD CONSTRAINT "AssignmentInvitation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "VerificationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentInvitation" ADD CONSTRAINT "AssignmentInvitation_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "VerifierProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationAssignment" ADD CONSTRAINT "VerificationAssignment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "VerificationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationAssignment" ADD CONSTRAINT "VerificationAssignment_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "VerifierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldVisit" ADD CONSTRAINT "FieldVisit_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "VerificationAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldVisit" ADD CONSTRAINT "FieldVisit_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "VerificationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldVisit" ADD CONSTRAINT "FieldVisit_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "VerifierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEvidence" ADD CONSTRAINT "VerificationEvidence_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "VerificationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEvidence" ADD CONSTRAINT "VerificationEvidence_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "FieldVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEvidence" ADD CONSTRAINT "VerificationEvidence_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "VerifierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationFinding" ADD CONSTRAINT "VerificationFinding_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "VerificationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationReport" ADD CONSTRAINT "VerificationReport_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "VerificationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationDispute" ADD CONSTRAINT "VerificationDispute_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "VerificationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationDispute" ADD CONSTRAINT "VerificationDispute_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "VerificationReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualReview" ADD CONSTRAINT "ManualReview_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "VerificationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudSignal" ADD CONSTRAINT "FraudSignal_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "VerificationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudSignal" ADD CONSTRAINT "FraudSignal_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "VerifierProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "VerificationRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "VerifierProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "VerifierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingPlan" ADD CONSTRAINT "PricingPlan_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "Country"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkUpload" ADD CONSTRAINT "BulkUpload_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Hand-written: spatial indexes and concurrency guarantees ─────────────────
CREATE INDEX "Address_location_gist" ON "Address" USING GIST ("location");
CREATE INDEX "VerifierAvailability_location_gist" ON "VerifierAvailability" USING GIST ("location");
CREATE INDEX "VerifierLocation_location_gist" ON "VerifierLocation" USING GIST ("location");

-- At most one live assignment per verification request. Together with the conditional
-- status update in AssignmentService.accept this makes double acceptance impossible.
CREATE UNIQUE INDEX "VerificationAssignment_one_active_per_request"
  ON "VerificationAssignment" ("requestId")
  WHERE "status" IN ('ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'SUBMITTED');

-- The ledger is append-only.
CREATE OR REPLACE FUNCTION avn_forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'WalletTransaction rows are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "WalletTransaction_immutable"
  BEFORE UPDATE OR DELETE ON "WalletTransaction"
  FOR EACH ROW EXECUTE FUNCTION avn_forbid_ledger_mutation();

-- Wallet balances can never go negative (postpaid credit is modelled separately).
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_non_negative_available" CHECK ("ownerType" = 'ORGANISATION' OR "availableBalance" >= 0);
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_non_negative_pending" CHECK ("pendingBalance" >= 0 AND "heldBalance" >= 0);
