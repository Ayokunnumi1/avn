import { z } from 'zod';
import { hashToken } from '@avn/auth';
import {
  DEFAULT_POLICY_RULES,
  FINAL_REQUEST_STATUSES,
  STATUS_LABELS,
  TIMELINE_STEPS,
  applicantSubmissionSchema,
  dataSubjectRequestSchema,
  disputeSchema,
  documentUploadMetaSchema,
  individualRequestSchema,
  timelineIndex,
  type RequestStatus,
} from '@avn/contracts';
import { Prisma } from '@avn/database';
import { maskPhone, normalisePhone } from '@avn/shared-utils';
import { reference } from '@avn/shared-utils/crypto';
import { DOCUMENT_MIME } from '@avn/storage';
import { deps } from '../../container';
import { actorFrom, audit } from '../../lib/audit';
import { requireApplicant } from '../../lib/auth';
import type { Ctx } from '../../lib/http';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { storeFile, upload } from '../../lib/files';
import { routes, uuidParam } from '../../lib/http';
import { enqueue } from '../../lib/jobs';
import { withTx } from '../../lib/tx';
import { createSession, issueOtp, verifyOtp } from '../auth/service';
import { initPayment } from '../payments/service';
import { quote } from '../requests/pricing';
import { addressLines, createAddress, recordConsent, submitApplicantDetails } from '../requests/service';
import { OUTCOME_LABELS } from '../verification/engine';

export const applicantRoutes = routes('/me', 'Applicants');
export const invitationRoutes = routes('/invitations', 'Applicants');

/** Applicant may access a request they own; guest sessions are restricted to their invitation's request. */
async function ownRequest(ctx: Ctx<unknown, unknown>, id: string) {
  const r = await deps().prisma.verificationRequest.findUnique({ where: { id } });
  if (!r || r.applicantUserId !== ctx.auth.user!.id) throw notFound('Verification request');
  if (ctx.auth.session?.scopeRequestId && ctx.auth.session.scopeRequestId !== id) throw forbidden();
  return r;
}

applicantRoutes.get('/dashboard', { summary: 'Applicant dashboard counts and recent activity', guard: requireApplicant }, async (ctx) => {
  const { prisma } = deps();
  const where = { applicantUserId: ctx.auth.user!.id, ...(ctx.auth.session?.scopeRequestId ? { id: ctx.auth.session.scopeRequestId } : {}) };
  const [total, pending, completed, attention, recent] = await Promise.all([
    prisma.verificationRequest.count({ where }),
    prisma.verificationRequest.count({ where: { ...where, status: { notIn: [...FINAL_REQUEST_STATUSES] } } }),
    prisma.verificationRequest.count({ where: { ...where, status: { in: ['COMPLETED', 'PARTIALLY_VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE'] } } }),
    prisma.verificationRequest.count({ where: { ...where, OR: [{ status: 'AWAITING_APPLICANT' }, { status: 'CREATED', paidAt: null, source: 'INDIVIDUAL' }] } }),
    prisma.requestStatusEvent.findMany({ where: { request: where }, orderBy: { createdAt: 'desc' }, take: 8, include: { request: { select: { reference: true, id: true } } } }),
  ]);
  return {
    greeting: ctx.auth.user!.fullName.split(' ')[0],
    total,
    pending,
    completed,
    requiresAttention: attention,
    recentActivity: recent.map((e) => ({ requestId: e.request.id, reference: e.request.reference, status: e.toStatus, label: STATUS_LABELS[e.toStatus], at: e.createdAt })),
  };
});

applicantRoutes.get('/requests', { summary: 'My verification requests', guard: requireApplicant }, async (ctx) => {
  const rows = await deps().prisma.verificationRequest.findMany({
    where: { applicantUserId: ctx.auth.user!.id, ...(ctx.auth.session?.scopeRequestId ? { id: ctx.auth.session.scopeRequestId } : {}) },
    orderBy: { createdAt: 'desc' },
    include: { organisation: { select: { legalName: true, tradingName: true } }, address: true },
  });
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    status: r.status,
    statusLabel: STATUS_LABELS[r.status],
    outcome: r.outcome,
    level: r.level,
    source: r.source,
    requestedBy: r.organisation ? (r.organisation.tradingName ?? r.organisation.legalName) : 'You',
    address: addressLines(r.address).slice(0, 2).join(', '),
    createdAt: r.createdAt,
    needsPayment: r.source === 'INDIVIDUAL' && !r.paidAt && r.status === 'CREATED',
    needsSubmission: r.status === 'AWAITING_APPLICANT',
  }));
});

applicantRoutes.get('/requests/:id', { summary: 'Request tracking: timeline, timestamps, report (no restricted institution data)', guard: requireApplicant }, async (ctx) => {
  const r0 = await ownRequest(ctx, uuidParam(ctx));
  const r = await deps().prisma.verificationRequest.findUniqueOrThrow({
    where: { id: r0.id },
    include: {
      statusEvents: { orderBy: { createdAt: 'asc' } },
      address: true,
      organisation: { select: { legalName: true, tradingName: true } },
      reports: { where: { revokedAt: null }, orderBy: { version: 'desc' }, take: 1 },
      documents: true,
      disputes: { orderBy: { createdAt: 'desc' } },
      fieldVisits: { orderBy: { createdAt: 'desc' }, take: 1, select: { arrivalAt: true, applicantConfirmedAt: true, confirmationExpiresAt: true } },
      payments: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  const at = (statuses: RequestStatus[]) => r.statusEvents.find((e) => statuses.includes(e.toStatus))?.createdAt ?? null;
  const idx = timelineIndex(r.status);
  const stepStatuses: Record<string, RequestStatus[]> = {
    created: ['CREATED'],
    submitted: ['READY_FOR_ASSIGNMENT'],
    waiting: ['DISPATCHING'],
    assigned: ['ACCEPTED', 'ASSIGNED'],
    visit: ['ARRIVED', 'VISIT_IN_PROGRESS'],
    evidence: ['EVIDENCE_SUBMITTED'],
    review: ['PROCESSING', 'MANUAL_REVIEW'],
    completed: ['COMPLETED', 'PARTIALLY_VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE'],
  };
  const visit = r.fieldVisits[0];
  const report = r.reports[0];
  return {
    id: r.id,
    reference: r.reference,
    status: r.status,
    statusLabel: STATUS_LABELS[r.status],
    outcome: r.outcome,
    outcomeLabel: r.outcome ? OUTCOME_LABELS[r.outcome] : null,
    level: r.level,
    purpose: r.purpose,
    source: r.source,
    requestedBy: r.organisation ? (r.organisation.tradingName ?? r.organisation.legalName) : null,
    lockedFields: r.lockedFields,
    applicantName: r.applicantName,
    applicantPhoneMasked: maskPhone(r.applicantPhone),
    address: r.address ? { lines: addressLines(r.address), lat: r.address.lat, lng: r.address.lng, landmark: r.address.landmark } : null,
    price: r.source === 'INDIVIDUAL' ? r.price.toFixed(2) : null,
    currency: r.currency,
    paid: r.source === 'INDIVIDUAL' ? !!r.paidAt : null,
    payment: r.payments[0] ? { reference: r.payments[0].reference, status: r.payments[0].status } : null,
    coverageFallback: r.coverageFallback,
    timeline: TIMELINE_STEPS.map((s, i) => ({ key: s.key, label: s.label, done: idx >= i, current: idx === i, at: at(stepStatuses[s.key]!) })),
    terminal: r.status === 'CANCELLED' || r.status === 'EXPIRED' ? { status: r.status, at: at([r.status]) } : null,
    events: r.statusEvents.map((e) => ({ status: e.toStatus, label: STATUS_LABELS[e.toStatus], at: e.createdAt })),
    visit: visit ? { arrivedAt: visit.arrivalAt, applicantConfirmedAt: visit.applicantConfirmedAt, confirmationPending: !!visit.confirmationExpiresAt && !visit.applicantConfirmedAt && visit.confirmationExpiresAt > new Date() } : null,
    documents: r.documents.map((d) => ({ id: d.id, documentType: d.documentType, createdAt: d.createdAt })),
    report: report ? { id: report.id, reference: report.reference, outcome: report.outcome, outcomeLabel: OUTCOME_LABELS[report.outcome], issuedAt: report.issuedAt, validUntil: report.validUntil, summary: report.summary, contentHashPrefix: report.contentHash.slice(0, 16) } : null,
    disputes: r.disputes.map((d) => ({ id: d.id, reason: d.reason, status: d.status, createdAt: d.createdAt, resolutionNote: d.resolutionNote })),
  };
});

applicantRoutes.get(
  '/quote',
  { summary: 'Price, expected service level for an individual verification', guard: requireApplicant, query: z.object({ level: z.enum(['BASIC', 'STANDARD', 'ENHANCED']), countryCode: z.string().length(2).default('NG') }) },
  async (ctx) => withTx((tx) => quote(tx, ctx.query.countryCode, ctx.query.level, 'INDIVIDUAL')),
);

applicantRoutes.post('/requests', { summary: 'Individual: create a verification (address + level); pay next', guard: requireApplicant, body: individualRequestSchema }, async (ctx) => {
  if (ctx.auth.user!.isGuest) throw forbidden('Create a full account to purchase verifications');
  const user = ctx.auth.user!;
  const phone = normalisePhone(user.phone ?? '', user.countryCode);
  if (!phone) throw badRequest('Add a verified phone number to your account first');
  const r = await withTx(async (tx) => {
    const q = await quote(tx, ctx.body.address.countryCode, ctx.body.level, 'INDIVIDUAL');
    const address = await createAddress(tx, ctx.body.address, { userId: user.id });
    const req = await tx.verificationRequest.create({
      data: {
        reference: reference('AVN'),
        applicantUserId: user.id,
        createdByUserId: user.id,
        source: 'INDIVIDUAL',
        level: ctx.body.level,
        purpose: ctx.body.purpose,
        applicantName: ctx.body.fullName,
        applicantPhone: phone,
        applicantEmail: ctx.body.email ?? user.email,
        applicantDob: ctx.body.dateOfBirth,
        addressId: address.id,
        policySnapshot: { name: 'Individual standard', rules: DEFAULT_POLICY_RULES } as object,
        deadline: new Date(Date.now() + q.slaHours * 3600_000),
        price: new Prisma.Decimal(q.price),
        verifierReward: new Prisma.Decimal(q.reward),
        currency: q.currency,
        visitWindow: (ctx.body.visitWindow ?? undefined) as object | undefined,
        consent: ctx.body.consent as object,
        consentAt: new Date(),
        submittedAt: new Date(),
        statusEvents: { create: { toStatus: 'CREATED', actorType: 'APPLICANT', actorId: user.id } },
      },
    });
    await recordConsent(tx, user.id, req.id, ctx.ip);
    await audit(actorFrom(ctx), 'request.created', 'VerificationRequest', req.id, { source: 'INDIVIDUAL', price: q.price }, { db: tx });
    return req;
  });
  return { id: r.id, reference: r.reference, price: r.price.toFixed(2), currency: r.currency, status: r.status };
});

applicantRoutes.post('/requests/:id/pay', { summary: 'Start payment for an individual verification', guard: requireApplicant }, async (ctx) => {
  const r = await ownRequest(ctx, uuidParam(ctx));
  if (r.source !== 'INDIVIDUAL') throw badRequest('This verification is paid for by the requesting institution');
  if (r.paidAt || r.status !== 'CREATED') throw conflict('Already paid');
  const email = ctx.auth.user!.email ?? r.applicantEmail ?? `${r.applicantPhone.replace('+', '')}@payments.avn.local`;
  const payment = await initPayment({
    purpose: 'INDIVIDUAL_VERIFICATION',
    amount: r.price.toFixed(2),
    currency: r.currency,
    email,
    userId: ctx.auth.user!.id,
    requestId: r.id,
    callbackUrl: `${deps().env.APPLICANT_APP_URL}/payments/callback`,
  });
  return { reference: payment.reference, authorizationUrl: payment.authorizationUrl, provider: payment.provider };
});

applicantRoutes.post('/requests/:id/submit', { summary: 'Applicant submits address details for an institution request', guard: requireApplicant, body: applicantSubmissionSchema }, async (ctx) => {
  const r = await ownRequest(ctx, uuidParam(ctx));
  await withTx((tx, after) => submitApplicantDetails(tx, after, r.id, ctx.auth.user!.id, ctx.body, actorFrom(ctx)));
  return { submitted: true };
});

applicantRoutes.post(
  '/requests/:id/documents',
  { summary: 'Upload a supplementary document (PDF or image)', guard: requireApplicant, upload: upload('file'), body: documentUploadMetaSchema },
  async (ctx) => {
    const r = await ownRequest(ctx, uuidParam(ctx));
    if ((FINAL_REQUEST_STATUSES as readonly string[]).includes(r.status)) throw conflict('This request is closed');
    if (!ctx.file) throw badRequest('Attach a file');
    const count = await deps().prisma.applicantDocument.count({ where: { requestId: r.id } });
    if (count >= 5) throw badRequest('A maximum of 5 documents can be uploaded');
    const file = await storeFile({ data: ctx.file.buffer, allowed: DOCUMENT_MIME, purpose: 'applicant-document', ownerUserId: ctx.auth.user!.id, organisationId: r.organisationId, originalName: ctx.file.originalname });
    const doc = await deps().prisma.applicantDocument.create({ data: { requestId: r.id, uploadedById: ctx.auth.user!.id, documentType: ctx.body.documentType, fileId: file.id } });
    await audit(actorFrom(ctx), 'document.uploaded', 'ApplicantDocument', doc.id, { type: ctx.body.documentType }, { organisationId: r.organisationId });
    await enqueue('ai.document', { documentId: doc.id });
    return { id: doc.id, documentType: doc.documentType, note: 'Documents support the verification but do not by themselves establish your physical address.' };
  },
);

applicantRoutes.post('/requests/:id/visit/confirm', { summary: 'Confirm, in your own app, that the verifier is at your address', guard: requireApplicant }, async (ctx) => {
  const r = await ownRequest(ctx, uuidParam(ctx));
  if (r.status !== 'VISIT_IN_PROGRESS') throw conflict('No visit is in progress');
  const visit = await deps().prisma.fieldVisit.findFirst({ where: { requestId: r.id, submittedAt: null }, orderBy: { createdAt: 'desc' } });
  if (!visit) throw conflict('No visit is in progress');
  await deps().prisma.fieldVisit.update({ where: { id: visit.id }, data: { applicantConfirmedAt: new Date(), confirmationMethod: 'APPLICANT_APP' } });
  await audit(actorFrom(ctx), 'visit.applicant_confirmed', 'FieldVisit', visit.id, { method: 'APPLICANT_APP' });
  return { confirmed: true, note: 'Thank you. Your confirmation is recorded; it does not by itself establish residence.' };
});

applicantRoutes.post('/requests/:id/disputes', { summary: 'Raise a dispute on a completed verification', guard: requireApplicant, body: disputeSchema }, async (ctx) => {
  const r = await ownRequest(ctx, uuidParam(ctx));
  if (!['COMPLETED', 'PARTIALLY_VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE'].includes(r.status)) throw conflict('Disputes can be raised once a verification is complete');
  const report = await deps().prisma.verificationReport.findFirst({ where: { requestId: r.id, revokedAt: null }, orderBy: { version: 'desc' } });
  const d = await deps().prisma.verificationDispute.create({ data: { requestId: r.id, reportId: report?.id, raisedByUserId: ctx.auth.user!.id, raisedByType: 'APPLICANT', reason: ctx.body.reason, details: ctx.body.details } });
  await audit(actorFrom(ctx), 'dispute.raised', 'VerificationDispute', d.id, { by: 'APPLICANT' }, { organisationId: r.organisationId });
  return { id: d.id, status: d.status };
});

applicantRoutes.post('/data-requests', { summary: 'Data-subject request (access, deletion, correction) under NDPA 2023', guard: requireApplicant, body: dataSubjectRequestSchema }, async (ctx) => {
  const d = await deps().prisma.dataSubjectRequest.create({ data: { userId: ctx.auth.user!.id, kind: ctx.body.kind, details: ctx.body.details } });
  await audit(actorFrom(ctx), 'privacy.dsr_created', 'DataSubjectRequest', d.id, { kind: ctx.body.kind });
  return { id: d.id, status: d.status };
});

// ─── Institution invitation links (no permanent account required) ───────────
async function invitationByToken(token: string) {
  const inv = await deps().prisma.applicantInvitation.findUnique({
    where: { tokenHash: hashToken(deps().env.SESSION_SECRET, z.string().min(20).max(200).parse(token)) },
    include: { request: { include: { organisation: { select: { legalName: true, tradingName: true } } } } },
  });
  if (!inv) throw notFound('Invitation');
  if (inv.status === 'REVOKED') throw new AppError(410, 'INVITATION_REVOKED', 'This invitation is no longer valid');
  if (inv.expiresAt < new Date() && inv.status !== 'COMPLETED') throw new AppError(410, 'INVITATION_EXPIRED', 'This invitation has expired. Ask the institution to resend it.');
  return inv;
}

invitationRoutes.get('/:token', { summary: 'Open an institution invitation', public: true }, async (ctx) => {
  const inv = await invitationByToken(ctx.params.token!);
  const r = inv.request;
  return {
    organisation: r.organisation?.tradingName ?? r.organisation?.legalName,
    applicantName: r.applicantName,
    phoneMasked: maskPhone(inv.phone),
    status: inv.status,
    requestStatus: r.status,
    level: r.level,
    purpose: r.purpose,
    lockedFields: r.lockedFields,
    expiresAt: inv.expiresAt,
  };
});

invitationRoutes.post('/:token/otp', { summary: 'Send a code to the invited phone number', public: true }, async (ctx) => {
  const inv = await invitationByToken(ctx.params.token!);
  return { sent: true, ...(await issueOtp(inv.phone, `invitation:${inv.id}`, ctx.ip)) };
});

invitationRoutes.post('/:token/verify', { summary: 'Verify the code and start a guest session scoped to this request', public: true, body: z.object({ code: z.string().regex(/^\d{6}$/) }) }, async (ctx, _req, res) => {
  const inv = await invitationByToken(ctx.params.token!);
  await verifyOtp(inv.phone, `invitation:${inv.id}`, ctx.body.code);
  const { prisma } = deps();
  let user = await prisma.user.findUnique({ where: { accountType_phone: { accountType: 'APPLICANT', phone: inv.phone } } });
  const guest = !user;
  if (!user) {
    user = await prisma.user.create({ data: { accountType: 'APPLICANT', isGuest: true, phone: inv.phone, phoneVerifiedAt: new Date(), fullName: inv.request.applicantName, email: inv.email, applicantProfile: { create: {} } } });
  }
  if (inv.request.applicantUserId && inv.request.applicantUserId !== user.id) throw forbidden();
  await prisma.$transaction([
    prisma.verificationRequest.update({ where: { id: inv.requestId }, data: { applicantUserId: user.id } }),
    prisma.applicantInvitation.update({ where: { id: inv.id }, data: { status: inv.status === 'PENDING' ? 'OPENED' : inv.status, openedAt: inv.openedAt ?? new Date() } }),
  ]);
  await createSession(res, user, 'applicant', { scopeRequestId: user.isGuest ? inv.requestId : undefined, guest: user.isGuest, ip: ctx.ip, userAgent: ctx.userAgent });
  await audit(actorFrom(ctx), 'invitation.opened', 'ApplicantInvitation', inv.id, { guest }, { organisationId: inv.request.organisationId });
  return { requestId: inv.requestId, guest: user.isGuest };
});
