import { issueToken } from '@avn/auth';
import {
  FINAL_REQUEST_STATUSES,
  policyRulesSchema,
  type AddressInput,
  type ApplicantSubmissionInput,
  type InstitutionRequestInput,
  type PolicyRules,
  type RequestSource,
} from '@avn/contracts';
import { Prisma, type Tx } from '@avn/database';
import { normalisePhone } from '@avn/shared-utils';
import { reference } from '@avn/shared-utils/crypto';
import { isValidCoordinate } from '@avn/shared-utils/geo';
import { deps } from '../../container';
import { audit, type AuditActor } from '../../lib/audit';
import { AppError, badRequest, conflict, forbidden } from '../../lib/errors';
import { ensureWallet, postEntry } from '../../lib/ledger';
import { sendDirect } from '../../lib/notify';
import type { After } from '../../lib/tx';
import { emitWebhook } from '../integrations/webhooks';
import { quote, resolvePolicy } from './pricing';
import { transition, type TransitionActor } from './transitions';

export const LOCKED_INSTITUTION_FIELDS = ['applicantName', 'applicantPhone', 'level', 'purpose', 'policy', 'deadline'];
export const INVITATION_TTL_DAYS = 7;
export const CONSENT_TEXT_VERSION = 'consent@2026-11';

export function assertCoordinates(lat: number, lng: number) {
  if (!isValidCoordinate(lat, lng)) throw new AppError(422, 'INVALID_COORDINATES', 'The selected map location is not valid. Move the pin onto the property.');
}

export async function createAddress(tx: Tx, input: AddressInput, owner: { userId?: string | null; organisationId?: string | null }) {
  assertCoordinates(input.lat, input.lng);
  return tx.address.create({
    data: {
      ownerUserId: owner.userId ?? null,
      organisationId: owner.organisationId ?? null,
      countryCode: input.countryCode,
      state: input.state,
      lga: input.lga,
      city: input.city,
      district: input.district,
      street: input.street,
      houseNumber: input.houseNumber,
      estate: input.estate,
      landmark: input.landmark,
      directions: input.directions,
      lat: input.lat,
      lng: input.lng,
      locationSource: input.locationSource,
      gpsAccuracyM: input.gpsAccuracyM,
    },
  });
}

export async function issueApplicantInvitation(tx: Tx, requestId: string, phone: string, email?: string | null) {
  const { env } = deps();
  const { raw, hash } = issueToken(env.SESSION_SECRET);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 3600_000);
  await tx.applicantInvitation.upsert({
    where: { requestId },
    create: { requestId, tokenHash: hash, phone, email: email ?? null, expiresAt },
    update: { tokenHash: hash, status: 'PENDING', expiresAt },
  });
  return { url: `${env.APPLICANT_APP_URL}/invite/${raw}`, expiresAt };
}

export async function sendInvitation(requestId: string, url: string) {
  const { prisma } = deps();
  const r = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: requestId }, include: { organisation: true, invitation: true } });
  const vars = { organisation: r.organisation?.tradingName ?? r.organisation?.legalName ?? 'An institution', link: url };
  await sendDirect('SMS', r.applicantPhone, 'applicant.invitation', vars);
  if (r.applicantEmail) await sendDirect('EMAIL', r.applicantEmail, 'applicant.invitation', vars);
  await prisma.applicantInvitation.update({ where: { requestId }, data: { sendCount: { increment: 1 }, lastSentAt: new Date() } });
}

export interface InstitutionCreateContext {
  organisationId: string;
  source: RequestSource;
  createdByUserId?: string | null;
  apiCredentialId?: string | null;
  bulkUploadId?: string | null;
  actor: AuditActor;
}

/** Institution / API / bulk request creation (spec C5). Charges the prepaid wallet atomically. */
export async function createInstitutionRequest(tx: Tx, after: After, c: InstitutionCreateContext, input: InstitutionRequestInput) {
  const org = await tx.organisation.findUniqueOrThrow({ where: { id: c.organisationId } });
  if (org.status !== 'APPROVED') throw forbidden('Organisation is not approved');
  const phone = normalisePhone(input.applicantPhone, org.countryCode);
  if (!phone) throw badRequest('Invalid applicant phone number');

  const active = await tx.verificationRequest.findFirst({
    where: { organisationId: org.id, customerReference: input.customerReference, status: { notIn: [...FINAL_REQUEST_STATUSES] } },
    select: { reference: true },
  });
  if (active) throw conflict(`An active verification already exists for customer reference ${input.customerReference} (${active.reference})`);

  const policy = await resolvePolicy(tx, org.id, input.policyId);
  const q = await quote(tx, input.address?.countryCode ?? org.countryCode, input.level, 'INSTITUTION', org.id);
  const deadline = input.deadline ?? new Date(Date.now() + policy.rules.completionDeadlineHours * 3600_000);
  if (deadline.getTime() < Date.now() + 3600_000) throw badRequest('Deadline must be at least one hour in the future');

  let addressId: string | undefined;
  const a = input.address;
  if (a && a.lat != null && a.lng != null && a.state && a.city && a.street) {
    addressId = (await createAddress(tx, a as AddressInput, { organisationId: org.id })).id;
  }

  const ref = reference('AVN');
  const request = await tx.verificationRequest.create({
    data: {
      reference: ref,
      organisationId: org.id,
      createdByUserId: c.createdByUserId ?? null,
      apiCredentialId: c.apiCredentialId ?? null,
      bulkUploadId: c.bulkUploadId ?? null,
      source: c.source,
      level: input.level,
      purpose: input.purpose,
      priority: input.priority,
      customerReference: input.customerReference,
      department: input.department,
      applicantName: input.applicantName,
      applicantPhone: phone,
      applicantEmail: input.applicantEmail ?? null,
      addressId,
      lockedFields: LOCKED_INSTITUTION_FIELDS,
      policyVersionId: policy.versionId,
      policySnapshot: { name: policy.name, rules: policy.rules } as object,
      instructions: input.instructions,
      deadline,
      price: new Prisma.Decimal(q.price),
      verifierReward: new Prisma.Decimal(q.reward),
      currency: q.currency,
      chargedAt: new Date(),
      statusEvents: { create: { toStatus: 'CREATED', actorType: c.source === 'API' ? 'API' : 'INSTITUTION', actorId: c.createdByUserId ?? c.apiCredentialId ?? null } },
    },
  });

  const wallet = await ensureWallet(tx, 'ORGANISATION', org.id, q.currency);
  await postEntry(tx, {
    walletId: wallet.id,
    direction: 'DEBIT',
    bucket: 'AVAILABLE',
    category: 'VERIFICATION_CHARGE',
    amount: q.price,
    reference: `charge:${request.id}`,
    description: `Verification ${ref} (${input.level})`,
    requestId: request.id,
    createdById: c.createdByUserId ?? undefined,
    overdraftLimit: org.postpaidEnabled ? org.creditLimit.toString() : 0,
  });

  const invitation = await issueApplicantInvitation(tx, request.id, phone, input.applicantEmail);
  await transition(tx, after, request.id, 'AWAITING_APPLICANT', { type: 'SYSTEM' }, { note: 'Applicant invitation issued' });
  await audit(c.actor, 'request.created', 'VerificationRequest', request.id, { reference: ref, source: c.source, price: q.price }, { organisationId: org.id, db: tx });

  after(async () => {
    await emitWebhook(org.id, 'verification.created', { id: request.id, reference: ref, customerReference: input.customerReference, status: 'AWAITING_APPLICANT' });
    if (input.sendInvitation) await sendInvitation(request.id, invitation.url);
  });
  return { request: { ...request, status: 'AWAITING_APPLICANT' as const }, invitationUrl: invitation.url, invitationExpiresAt: invitation.expiresAt };
}

/** Applicant completes an institution-initiated request (spec A4). Restricted fields stay as the institution set them. */
export async function submitApplicantDetails(tx: Tx, after: After, requestId: string, userId: string, input: ApplicantSubmissionInput, actor: AuditActor) {
  const r = await tx.verificationRequest.findUniqueOrThrow({ where: { id: requestId }, include: { documents: true } });
  if (r.applicantUserId !== userId) throw forbidden();
  if (r.status !== 'AWAITING_APPLICANT') throw conflict('This request has already been submitted');
  const rules = policyRulesSchema.parse((r.policySnapshot as { rules?: PolicyRules }).rules ?? {});
  if (rules.supportingDocumentRequired && r.documents.length === 0) throw badRequest('This verification requires a supporting document. Upload one before submitting.');
  const address = await createAddress(tx, input.address, { userId });
  await recordConsent(tx, userId, requestId, actor.ip);
  await tx.applicantInvitation.updateMany({ where: { requestId }, data: { status: 'COMPLETED', completedAt: new Date() } });
  await transition(tx, after, requestId, 'READY_FOR_ASSIGNMENT', { type: 'APPLICANT', id: userId }, {
    note: 'Applicant submitted address',
    data: {
      addressId: address.id,
      applicantDob: input.dateOfBirth,
      applicantEmail: r.applicantEmail ?? input.email ?? null,
      visitWindow: (input.visitWindow ?? undefined) as object | undefined,
      consent: input.consent as object,
      consentAt: new Date(),
      submittedAt: new Date(),
    },
  });
  await audit(actor, 'request.applicant_submitted', 'VerificationRequest', requestId, { addressId: address.id }, { organisationId: r.organisationId, db: tx });
}

export async function recordConsent(tx: Tx, userId: string, requestId: string, ip?: string) {
  await tx.consentRecord.createMany({
    data: ['PRIVACY_NOTICE', 'VISIT_AUTHORISATION', 'REPORT_SHARING'].map((kind) => ({ userId, requestId, kind, granted: true, textVersion: CONSENT_TEXT_VERSION, ipAddress: ip })),
  });
}

/** Cancels a request; refunds the institution when no field work has started. */
export async function cancelRequest(tx: Tx, after: After, requestId: string, reason: string, actor: TransitionActor, audActor: AuditActor) {
  const r = await tx.verificationRequest.findUniqueOrThrow({ where: { id: requestId } });
  const fieldStarted = ['ARRIVED', 'VISIT_IN_PROGRESS', 'EVIDENCE_SUBMITTED', 'PROCESSING'].includes(r.status);
  if (fieldStarted) throw conflict('A field visit is already in progress and cannot be cancelled');
  await transition(tx, after, requestId, 'CANCELLED', actor, { note: reason, data: { cancelledReason: reason } });
  await tx.assignmentInvitation.updateMany({ where: { requestId, status: 'SENT' }, data: { status: 'WITHDRAWN' } });
  await tx.verificationAssignment.updateMany({
    where: { requestId, status: { in: ['ACCEPTED', 'EN_ROUTE'] } },
    data: { status: 'CANCELLED', releasedAt: new Date(), releaseReason: reason },
  });
  if (r.organisationId && r.chargedAt) {
    const wallet = await ensureWallet(tx, 'ORGANISATION', r.organisationId, r.currency);
    await postEntry(tx, {
      walletId: wallet.id,
      direction: 'CREDIT',
      bucket: 'AVAILABLE',
      category: 'VERIFICATION_REFUND',
      amount: r.price.toString(),
      reference: `refund:${r.id}`,
      description: `Refund for cancelled verification ${r.reference}`,
      requestId: r.id,
    });
  }
  await audit(audActor, 'request.cancelled', 'VerificationRequest', requestId, { reason }, { organisationId: r.organisationId, db: tx });
}

export function addressLines(a: { houseNumber: string | null; street: string; estate: string | null; district: string | null; city: string; lga: string | null; state: string } | null) {
  if (!a) return [];
  return [[a.houseNumber, a.street].filter(Boolean).join(' '), a.estate, a.district, a.city, a.lga, a.state].filter((x): x is string => !!x);
}
