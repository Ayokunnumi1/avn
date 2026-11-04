import { z } from 'zod';
import { hashPassword, verifyPassword } from '@avn/auth';
import {
  adminCreateSchema,
  aiConfigSchema,
  areaSchema,
  cancelSchema,
  countrySchema,
  disputeResolveSchema,
  fraudResolveSchema,
  manualAssignSchema,
  orgDecisionSchema,
  paginationSchema,
  payoutDecisionSchema,
  platformConfigSchema,
  pricingPlanSchema,
  refundSchema,
  requestFiltersSchema,
  reviewerNoteSchema,
  reviewResolveSchema,
  userStatusSchema,
  verifierDecisionSchema,
  STATUS_LABELS,
} from '@avn/contracts';
import { Prisma } from '@avn/database';
import { deps } from '../../container';
import { actorFrom, audit } from '../../lib/audit';
import { requireAdmin } from '../../lib/auth';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { signedFileUrl } from '../../lib/files';
import { paged, routes, uuidParam } from '../../lib/http';
import { enqueue } from '../../lib/jobs';
import { notifyUser } from '../../lib/notify';
import { getAiConfig, getPlatformConfig, saveSetting } from '../../lib/settings';
import { withTx } from '../../lib/tx';
import { monthSpendUsd } from '../ai/service';
import { releaseAssignment } from '../assignments/service';
import { refundPayment, reconcilePayments } from '../payments/service';
import { requestDetail } from '../requests/detail';
import { cancelRequest } from '../requests/service';
import { transition } from '../requests/transitions';
import { resolveReview, updateVerifierStats } from '../verification/process';
import { decidePayout } from '../wallets/payouts';

export const adminRoutes = routes('/admin', 'Administration');

/** Privileged-action confirmation: re-enter password (spec D1). */
async function confirmPrivileged(userId: string, password: string) {
  const u = await deps().prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(password, u.passwordHash))) throw new AppError(403, 'CONFIRMATION_FAILED', 'Password confirmation failed');
}

// ─── D2 Overview ─────────────────────────────────────────────────────────────
adminRoutes.get('/overview', { summary: 'Platform overview metrics', guard: requireAdmin('overview.read') }, async () => {
  const { prisma } = deps();
  const cfg = await getPlatformConfig();
  const fresh = new Date(Date.now() - cfg.heartbeatExpirySeconds * 1000);
  const [users, institutions, approvedVerifiers, availableVerifiers, active, completed, reviews, suspicious, revenue, payouts, coverage, pendingVerifiers, pendingOrgs] = await Promise.all([
    prisma.user.groupBy({ by: ['accountType'], _count: true, where: { deletedAt: null, isGuest: false } }),
    prisma.organisation.count({ where: { status: 'APPROVED' } }),
    prisma.verifierProfile.count({ where: { status: 'APPROVED' } }),
    prisma.verifierAvailability.count({ where: { isAvailable: true, lastHeartbeatAt: { gt: fresh } } }),
    prisma.verificationAssignment.count({ where: { status: { in: ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] } } }),
    prisma.verificationRequest.count({ where: { status: { in: ['COMPLETED', 'PARTIALLY_VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE'] } } }),
    prisma.manualReview.count({ where: { status: { not: 'RESOLVED' } } }),
    prisma.fraudSignal.count({ where: { status: 'OPEN', severity: 'HIGH' } }),
    prisma.$queryRaw<Array<{ total: string | null }>>`SELECT (coalesce((SELECT sum(amount) FROM "Payment" WHERE status = 'SUCCEEDED' AND purpose = 'INDIVIDUAL_VERIFICATION'), 0) + coalesce((SELECT sum(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END) FROM "WalletTransaction" WHERE category IN ('VERIFICATION_CHARGE','VERIFICATION_REFUND')), 0))::text AS total`,
    prisma.payout.aggregate({ where: { status: 'COMPLETED' }, _sum: { amount: true } }),
    prisma.$queryRaw<Array<{ state: string; requests: number }>>`SELECT a.state, count(*)::int AS requests FROM "VerificationRequest" r JOIN "Address" a ON a.id = r."addressId" GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
    prisma.verifierProfile.count({ where: { status: { in: ['MANUAL_REVIEW', 'IDENTITY_PENDING'] } } }),
    prisma.organisation.count({ where: { status: 'PENDING_REVIEW' } }),
  ]);
  return {
    totalUsers: users.reduce((n, u) => n + u._count, 0),
    usersByType: users.map((u) => ({ type: u.accountType, count: u._count })),
    totalInstitutions: institutions,
    approvedVerifiers,
    currentlyAvailableVerifiers: availableVerifiers,
    activeAssignments: active,
    completedVerifications: completed,
    pendingManualReviews: reviews,
    suspiciousAssignments: suspicious,
    totalRevenue: Number(revenue[0]?.total ?? 0).toFixed(2),
    verifierPayouts: payouts._sum.amount?.toFixed(2) ?? '0.00',
    geographicCoverage: coverage,
    queues: { pendingVerifierApprovals: pendingVerifiers, pendingOrganisationApprovals: pendingOrgs },
  };
});

// ─── D3 User management ──────────────────────────────────────────────────────
adminRoutes.get(
  '/users',
  { summary: 'Search users', guard: requireAdmin('users.manage'), query: paginationSchema.extend({ type: z.enum(['APPLICANT', 'VERIFIER', 'INSTITUTION', 'ADMIN']).optional(), status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(), q: z.string().max(100).optional() }) },
  async (ctx) => {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(ctx.query.type ? { accountType: ctx.query.type } : {}),
      ...(ctx.query.status ? { status: ctx.query.status } : {}),
      ...(ctx.query.q ? { OR: [{ fullName: { contains: ctx.query.q, mode: 'insensitive' } }, { email: { contains: ctx.query.q, mode: 'insensitive' } }, { phone: { contains: ctx.query.q } }] } : {}),
    };
    const [items, total] = await Promise.all([
      deps().prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (ctx.query.page - 1) * ctx.query.pageSize, take: ctx.query.pageSize, include: { verifierProfile: { select: { status: true } }, membership: { include: { organisation: { select: { legalName: true } } } } } }),
      deps().prisma.user.count({ where }),
    ]);
    return paged(
      items.map((u) => ({ id: u.id, fullName: u.fullName, email: u.email, phone: u.phone, accountType: u.accountType, status: u.status, isGuest: u.isGuest, adminRole: u.adminRole, mfaEnabled: u.mfaEnabled, verifierStatus: u.verifierProfile?.status ?? null, organisation: u.membership?.organisation.legalName ?? null, orgRole: u.membership?.role ?? null, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt })),
      total,
      ctx.query.page,
      ctx.query.pageSize,
    );
  },
);

adminRoutes.patch('/users/:id/status', { summary: 'Suspend or reinstate a user (revokes sessions on suspension)', guard: requireAdmin('users.manage'), body: userStatusSchema }, async (ctx) => {
  const id = uuidParam(ctx);
  if (id === ctx.auth.user!.id) throw badRequest('You cannot change your own status');
  const { prisma } = deps();
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u) throw notFound('User');
  if (u.accountType === 'ADMIN' && ctx.auth.user!.adminRole !== 'SUPER_ADMIN') throw new AppError(403, 'FORBIDDEN', 'Only super admins can change administrators');
  await prisma.user.update({ where: { id }, data: { status: ctx.body.status } });
  if (ctx.body.status === 'SUSPENDED') {
    await prisma.userSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'suspended' } });
    await prisma.verifierAvailability.updateMany({ where: { verifier: { userId: id } }, data: { isAvailable: false, endedReason: 'SUSPENDED' } });
  }
  await audit(actorFrom(ctx), `user.${ctx.body.status === 'SUSPENDED' ? 'suspended' : 'reinstated'}`, 'User', id, { reason: ctx.body.reason });
  return { ok: true };
});

adminRoutes.get('/users/:id/logins', { summary: 'Login audit history for a user', guard: requireAdmin('audit.read') }, async (ctx) =>
  deps().prisma.auditEvent.findMany({ where: { entityType: 'User', entityId: uuidParam(ctx), action: { startsWith: 'auth.' } }, orderBy: { createdAt: 'desc' }, take: 100 }),
);

adminRoutes.post('/admins', { summary: 'Create an administrator (super admin only, password confirmation)', guard: requireAdmin('config.manage'), body: adminCreateSchema.extend({ confirmPassword: z.string().min(1) }) }, async (ctx) => {
  if (ctx.auth.user!.adminRole !== 'SUPER_ADMIN') throw new AppError(403, 'FORBIDDEN', 'Only super admins can create administrators');
  await confirmPrivileged(ctx.auth.user!.id, ctx.body.confirmPassword);
  const u = await deps().prisma.user.create({ data: { accountType: 'ADMIN', adminRole: ctx.body.role, fullName: ctx.body.fullName, email: ctx.body.email, passwordHash: await hashPassword(ctx.body.password) } });
  await audit(actorFrom(ctx), 'admin.created', 'User', u.id, { role: ctx.body.role });
  return { id: u.id };
});

// ─── D4 Verifier approval ────────────────────────────────────────────────────
adminRoutes.get('/verifiers', { summary: 'Verifier registry / approval queue', guard: requireAdmin('verifiers.review'), query: paginationSchema.extend({ status: z.enum(['INCOMPLETE', 'IDENTITY_PENDING', 'MANUAL_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED']).optional(), q: z.string().max(100).optional() }) }, async (ctx) => {
  const where: Prisma.VerifierProfileWhereInput = { ...(ctx.query.status ? { status: ctx.query.status } : {}), ...(ctx.query.q ? { user: { OR: [{ fullName: { contains: ctx.query.q, mode: 'insensitive' } }, { phone: { contains: ctx.query.q } }] } } : {}) };
  const [items, total] = await Promise.all([
    deps().prisma.verifierProfile.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (ctx.query.page - 1) * ctx.query.pageSize, take: ctx.query.pageSize, include: { user: { select: { fullName: true, phone: true, email: true } }, availability: true } }),
    deps().prisma.verifierProfile.count({ where }),
  ]);
  return paged(items.map((v) => ({ id: v.id, fullName: v.user.fullName, phone: v.user.phone, email: v.user.email, status: v.status, reliabilityScore: v.reliabilityScore.toFixed(1), completedCount: v.completedCount, available: !!v.availability?.isAvailable, lastHeartbeatAt: v.availability?.lastHeartbeatAt ?? null, createdAt: v.createdAt })), total, ctx.query.page, ctx.query.pageSize);
});

adminRoutes.get('/verifiers/:id', { summary: 'Verifier profile, identity checks, performance', guard: requireAdmin('verifiers.review') }, async (ctx) => {
  const id = uuidParam(ctx);
  const v = await deps().prisma.verifierProfile.findUnique({ where: { id }, include: { user: true, identityChecks: { orderBy: { createdAt: 'desc' } }, availability: true, wallet: true, fraudSignals: { orderBy: { createdAt: 'desc' }, take: 20 }, assignments: { orderBy: { acceptedAt: 'desc' }, take: 20, include: { request: { select: { reference: true, status: true, outcome: true } } } } } });
  if (!v) throw notFound('Verifier');
  await audit(actorFrom(ctx), 'verifier.profile_viewed', 'VerifierProfile', id);
  return {
    id: v.id,
    fullName: v.user.fullName,
    email: v.user.email,
    phone: v.user.phone,
    userStatus: v.user.status,
    status: v.status,
    decisionReason: v.decisionReason,
    dateOfBirth: v.dateOfBirth,
    residentialAddress: v.residentialAddress,
    photoUrl: v.photoFileId ? signedFileUrl(v.photoFileId) : null,
    idType: v.idType,
    idNumberLast4: v.idNumberLast4,
    payoutAccount: v.payoutAccountLast4 ? { bank: v.payoutBankName, last4: v.payoutAccountLast4, name: v.payoutAccountName } : null,
    identityChecks: v.identityChecks.map((c) => ({ id: c.id, provider: c.provider, idType: c.idType, status: c.status, resultSummary: c.resultSummary, idDocumentUrl: c.idDocumentFileId ? signedFileUrl(c.idDocumentFileId) : null, selfieUrl: c.selfieFileId ? signedFileUrl(c.selfieFileId) : null, createdAt: c.createdAt })),
    performance: { reliabilityScore: v.reliabilityScore.toFixed(1), completed: v.completedCount, onTime: v.onTimeCount, auditPass: v.auditPassCount, auditFail: v.auditFailCount },
    availability: v.availability ? { isAvailable: v.availability.isAvailable, lastHeartbeatAt: v.availability.lastHeartbeatAt } : null,
    wallet: v.wallet ? { pending: v.wallet.pendingBalance.toFixed(2), available: v.wallet.availableBalance.toFixed(2), held: v.wallet.heldBalance.toFixed(2) } : null,
    fraudSignals: v.fraudSignals,
    assignments: v.assignments.map((a) => ({ id: a.id, status: a.status, reference: a.request.reference, requestStatus: a.request.status, outcome: a.request.outcome, acceptedAt: a.acceptedAt })),
  };
});

adminRoutes.post('/verifiers/:id/decision', { summary: 'Approve, reject, suspend or reinstate a verifier', guard: requireAdmin('verifiers.review'), body: verifierDecisionSchema }, async (ctx) => {
  const id = uuidParam(ctx);
  const { prisma } = deps();
  const v = await prisma.verifierProfile.findUnique({ where: { id } });
  if (!v) throw notFound('Verifier');
  const map = { APPROVE: 'APPROVED', REJECT: 'REJECTED', SUSPEND: 'SUSPENDED', REINSTATE: 'APPROVED' } as const;
  const allowed: Record<string, string[]> = { APPROVE: ['MANUAL_REVIEW', 'IDENTITY_PENDING'], REJECT: ['MANUAL_REVIEW', 'IDENTITY_PENDING', 'INCOMPLETE'], SUSPEND: ['APPROVED'], REINSTATE: ['SUSPENDED'] };
  if (!allowed[ctx.body.decision]!.includes(v.status)) throw conflict(`Cannot ${ctx.body.decision.toLowerCase()} a verifier in status ${v.status}`);
  if (ctx.body.decision === 'APPROVE') {
    const passedOrReviewed = await prisma.verifierIdentityCheck.count({ where: { verifierId: id, status: { in: ['PASSED', 'MANUAL_REVIEW'] } } });
    if (!passedOrReviewed) throw conflict('No identity check on file — the verifier must submit identity details first');
  }
  const status = map[ctx.body.decision];
  await prisma.verifierProfile.update({ where: { id }, data: { status, decisionReason: ctx.body.reason, ...(ctx.body.decision === 'APPROVE' ? { approvedAt: new Date(), approvedById: ctx.auth.user!.id } : {}) } });
  if (ctx.body.decision === 'APPROVE') await prisma.verifierIdentityCheck.updateMany({ where: { verifierId: id, status: 'MANUAL_REVIEW' }, data: { status: 'PASSED', reviewedById: ctx.auth.user!.id, reviewNote: ctx.body.reason } });
  if (status === 'SUSPENDED') {
    await prisma.verifierAvailability.updateMany({ where: { verifierId: id }, data: { isAvailable: false, endedReason: 'SUSPENDED' } });
    await prisma.assignmentInvitation.updateMany({ where: { verifierId: id, status: 'SENT' }, data: { status: 'WITHDRAWN' } });
  }
  await audit(actorFrom(ctx), `verifier.${ctx.body.decision.toLowerCase()}`, 'VerifierProfile', id, { reason: ctx.body.reason, from: v.status, to: status });
  await notifyUser(v.userId, 'verifier.status', { status: status.toLowerCase() }, { channels: ['PUSH', 'SMS'] });
  return { status };
});

// ─── C1 Organisation approval ────────────────────────────────────────────────
adminRoutes.get('/organisations', { summary: 'Institutions', guard: requireAdmin('orgs.manage'), query: paginationSchema.extend({ status: z.enum(['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED']).optional() }) }, async (ctx) => {
  const where = ctx.query.status ? { status: ctx.query.status } : {};
  const [items, total] = await Promise.all([
    deps().prisma.organisation.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (ctx.query.page - 1) * ctx.query.pageSize, take: ctx.query.pageSize, include: { wallet: true, _count: { select: { requests: true, members: true } } } }),
    deps().prisma.organisation.count({ where }),
  ]);
  return paged(items.map((o) => ({ id: o.id, legalName: o.legalName, tradingName: o.tradingName, registrationNumber: o.registrationNumber, businessType: o.businessType, status: o.status, contactEmail: o.contactEmail, expectedMonthlyVolume: o.expectedMonthlyVolume, requests: o._count.requests, members: o._count.members, walletBalance: o.wallet?.availableBalance.toFixed(2) ?? '0.00', postpaidEnabled: o.postpaidEnabled, creditLimit: o.creditLimit.toFixed(2), createdAt: o.createdAt })), total, ctx.query.page, ctx.query.pageSize);
});

adminRoutes.get('/organisations/:id', { summary: 'Institution detail', guard: requireAdmin('orgs.manage') }, async (ctx) => {
  const o = await deps().prisma.organisation.findUnique({ where: { id: uuidParam(ctx) }, include: { members: { include: { user: { select: { fullName: true, email: true, lastLoginAt: true } } } }, wallet: true, policies: true } });
  if (!o) throw notFound('Organisation');
  return o;
});

adminRoutes.post('/organisations/:id/decision', { summary: 'Approve / reject / suspend / reinstate an institution; set postpaid credit', guard: requireAdmin('orgs.manage'), body: orgDecisionSchema }, async (ctx) => {
  const id = uuidParam(ctx);
  const { prisma } = deps();
  const o = await prisma.organisation.findUnique({ where: { id }, include: { members: { where: { role: 'OWNER' } } } });
  if (!o) throw notFound('Organisation');
  const status = ({ APPROVE: 'APPROVED', REJECT: 'REJECTED', SUSPEND: 'SUSPENDED', REINSTATE: 'APPROVED' } as const)[ctx.body.decision];
  const credit = ctx.body.postpaidCreditLimit;
  if (credit && status !== 'APPROVED') throw badRequest('Postpaid credit is only available to approved organisations');
  await prisma.organisation.update({
    where: { id },
    data: { status, decisionReason: ctx.body.reason, ...(status === 'APPROVED' ? { approvedAt: new Date(), approvedById: ctx.auth.user!.id } : {}), ...(credit ? { postpaidEnabled: Number(credit) > 0, creditLimit: new Prisma.Decimal(credit) } : {}), ...(status !== 'APPROVED' ? { postpaidEnabled: false } : {}) },
  });
  if (status === 'SUSPENDED') await prisma.apiCredential.updateMany({ where: { organisationId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(actorFrom(ctx), `org.${ctx.body.decision.toLowerCase()}`, 'Organisation', id, { reason: ctx.body.reason, credit }, { organisationId: id });
  for (const m of o.members) await notifyUser(m.userId, 'org.status', { status: status.toLowerCase() }, { channels: ['EMAIL', 'PUSH'] });
  return { status };
});

// ─── D5 Assignment management ────────────────────────────────────────────────
adminRoutes.get('/requests', { summary: 'All verification requests', guard: requireAdmin('assignments.manage'), query: requestFiltersSchema.extend({ organisationId: z.string().uuid().optional() }) }, async (ctx) => {
  const q = ctx.query;
  const where: Prisma.VerificationRequestWhereInput = {
    ...(q.organisationId ? { organisationId: q.organisationId } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.level ? { level: q.level } : {}),
    ...(q.risk === 'flagged' ? { riskFlagged: true } : {}),
    ...(q.verifierId ? { assignments: { some: { verifierId: q.verifierId } } } : {}),
    ...(q.state ? { address: { state: { equals: q.state, mode: 'insensitive' } } } : {}),
    ...(q.q ? { OR: [{ reference: { contains: q.q, mode: 'insensitive' } }, { applicantName: { contains: q.q, mode: 'insensitive' } }, { customerReference: { contains: q.q, mode: 'insensitive' } }] } : {}),
  };
  const [items, total] = await Promise.all([
    deps().prisma.verificationRequest.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { organisation: { select: { legalName: true } }, address: { select: { lat: true, lng: true, city: true, state: true } }, assignments: { where: { status: { in: ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] } }, include: { verifier: { include: { user: { select: { fullName: true } } } } } } } }),
    deps().prisma.verificationRequest.count({ where }),
  ]);
  return paged(
    items.map((r) => ({ id: r.id, reference: r.reference, status: r.status, statusLabel: STATUS_LABELS[r.status], outcome: r.outcome, source: r.source, organisation: r.organisation?.legalName ?? 'Individual', applicantName: r.applicantName, location: [r.address?.city, r.address?.state].filter(Boolean).join(', '), lat: r.address?.lat ?? null, lng: r.address?.lng ?? null, verifier: r.assignments[0]?.verifier.user.fullName ?? null, riskScore: r.riskScore, riskFlagged: r.riskFlagged, coverageFallback: r.coverageFallback, deadline: r.deadline, updatedAt: r.updatedAt, createdAt: r.createdAt })),
    total,
    q.page,
    q.pageSize,
  );
});

adminRoutes.get('/requests/:id', { summary: 'Full request investigation view', guard: requireAdmin('assignments.manage') }, async (ctx) => {
  const id = uuidParam(ctx);
  await audit(actorFrom(ctx), 'evidence.viewed', 'VerificationRequest', id);
  return requestDetail(id, { includeEvidence: true, admin: true });
});

adminRoutes.get('/map', { summary: 'Live operations map: active jobs and legitimately available verifier positions', guard: requireAdmin('assignments.manage') }, async () => {
  const { prisma } = deps();
  const cfg = await getPlatformConfig();
  const [jobs, verifiers] = await Promise.all([
    prisma.verificationRequest.findMany({ where: { status: { notIn: ['COMPLETED', 'PARTIALLY_VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE', 'CANCELLED', 'EXPIRED', 'CREATED', 'AWAITING_APPLICANT'] }, address: { isNot: null } }, include: { address: { select: { lat: true, lng: true, city: true } } }, take: 500 }),
    // Only fresh, on-duty positions are shown — stale coordinates are never presented as live.
    prisma.verifierAvailability.findMany({ where: { isAvailable: true, lastHeartbeatAt: { gt: new Date(Date.now() - cfg.heartbeatExpirySeconds * 1000) } }, include: { verifier: { include: { user: { select: { fullName: true } } } } } }),
  ]);
  return {
    jobs: jobs.map((j) => ({ id: j.id, reference: j.reference, status: j.status, lat: j.address!.lat, lng: j.address!.lng, city: j.address!.city, riskFlagged: j.riskFlagged })),
    verifiers: verifiers.filter((v) => v.lastLat != null).map((v) => ({ id: v.verifierId, name: v.verifier.user.fullName, lat: v.lastLat!, lng: v.lastLng!, accuracyM: v.lastAccuracyM, lastHeartbeatAt: v.lastHeartbeatAt })),
  };
});

adminRoutes.post('/requests/:id/assign', { summary: 'Manually assign an approved verifier (verifier must accept)', guard: requireAdmin('assignments.manage'), body: manualAssignSchema }, async (ctx) => {
  const id = uuidParam(ctx);
  const { prisma } = deps();
  const v = await prisma.verifierProfile.findUnique({ where: { id: ctx.body.verifierId }, include: { user: true } });
  if (!v || v.status !== 'APPROVED') throw conflict('Only approved verifiers can be assigned');
  const cfg = await getPlatformConfig();
  await withTx(async (tx, after) => {
    const r = await tx.verificationRequest.findUniqueOrThrow({ where: { id } });
    if (r.applicantPhone === v.user.phone) throw conflict('Conflict of interest: the verifier is the applicant');
    await tx.assignmentInvitation.updateMany({ where: { requestId: id, status: 'SENT' }, data: { status: 'WITHDRAWN' } });
    await tx.assignmentInvitation.upsert({
      where: { requestId_verifierId: { requestId: id, verifierId: v.id } },
      create: { requestId: id, verifierId: v.id, tier: -1, distanceM: 0, walkingMinutes: new Prisma.Decimal(0), routingSource: 'manual', reward: r.verifierReward, expiresAt: new Date(Date.now() + cfg.assignmentOfferSeconds * 4000) },
      update: { status: 'SENT', tier: -1, expiresAt: new Date(Date.now() + cfg.assignmentOfferSeconds * 4000), respondedAt: null },
    });
    await transition(tx, after, id, 'ASSIGNED', { type: 'ADMIN', id: ctx.auth.user!.id }, { note: `Manually assigned: ${ctx.body.reason}`, expectFrom: ['READY_FOR_ASSIGNMENT', 'DISPATCHING'] });
    await audit(actorFrom(ctx), 'assignment.manual_assigned', 'VerificationRequest', id, { verifierId: v.id, reason: ctx.body.reason }, { organisationId: r.organisationId, db: tx });
  });
  await notifyUser(v.userId, 'verifier.job_offer', { minutes: '—', reward: 'see app' }, { channels: ['PUSH', 'SMS'] });
  return { ok: true };
});

adminRoutes.post('/requests/:id/reassign', { summary: 'Release the current verifier and redispatch', guard: requireAdmin('assignments.manage'), body: cancelSchema }, async (ctx) => {
  const id = uuidParam(ctx);
  const a = await deps().prisma.verificationAssignment.findFirst({ where: { requestId: id, status: { in: ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] } } });
  if (!a) throw conflict('No active assignment to release');
  await releaseAssignment(a.id, ctx.body.reason, actorFrom(ctx), 'ADMIN');
  return { ok: true };
});

adminRoutes.post('/requests/:id/redispatch', { summary: 'Restart the location search from the first walking tier', guard: requireAdmin('assignments.manage') }, async (ctx) => {
  const id = uuidParam(ctx);
  await deps().prisma.verificationRequest.update({ where: { id }, data: { dispatchTier: 0, coverageFallback: null } });
  await deps().prisma.assignmentInvitation.updateMany({ where: { requestId: id, status: 'SENT' }, data: { status: 'WITHDRAWN' } });
  await audit(actorFrom(ctx), 'dispatch.restarted', 'VerificationRequest', id);
  await enqueue('dispatch.run', { requestId: id });
  return { ok: true };
});

adminRoutes.post('/requests/:id/cancel', { summary: 'Cancel a request', guard: requireAdmin('assignments.manage'), body: cancelSchema }, async (ctx) => {
  await withTx((tx, after) => cancelRequest(tx, after, uuidParam(ctx), ctx.body.reason, { type: 'ADMIN', id: ctx.auth.user!.id }, actorFrom(ctx)));
  return { ok: true };
});

// ─── D6 Evidence & quality control ───────────────────────────────────────────
adminRoutes.get('/reviews', { summary: 'Manual review queue', guard: requireAdmin('reviews.manage'), query: z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']).optional() }) }, async (ctx) => {
  const items = await deps().prisma.manualReview.findMany({ where: ctx.query.status ? { status: ctx.query.status } : { status: { not: 'RESOLVED' } }, orderBy: { createdAt: 'asc' }, take: 100, include: { request: { select: { reference: true, status: true, riskScore: true, organisation: { select: { legalName: true } } } } } });
  return items.map((m) => ({ id: m.id, requestId: m.requestId, reference: m.request.reference, organisation: m.request.organisation?.legalName ?? 'Individual', status: m.status, trigger: m.trigger, reasons: m.reasons, riskScore: m.request.riskScore, assignedToId: m.assignedToId, createdAt: m.createdAt }));
});
adminRoutes.post('/reviews/:id/claim', { summary: 'Claim a review', guard: requireAdmin('reviews.manage') }, async (ctx) => {
  const { count } = await deps().prisma.manualReview.updateMany({ where: { id: uuidParam(ctx), status: 'OPEN' }, data: { status: 'IN_PROGRESS', assignedToId: ctx.auth.user!.id } });
  if (!count) throw conflict('Review is not open');
  await audit(actorFrom(ctx), 'review.claimed', 'ManualReview', ctx.params.id!);
  return { ok: true };
});
adminRoutes.post('/reviews/:id/notes', { summary: 'Add a reviewer note', guard: requireAdmin('reviews.manage'), body: reviewerNoteSchema }, async (ctx) => {
  const m = await deps().prisma.manualReview.findUnique({ where: { id: uuidParam(ctx) } });
  if (!m) throw notFound('Review');
  const notes = [...((m.notes as unknown[]) ?? []), { by: ctx.auth.user!.id, byName: ctx.auth.user!.fullName, note: ctx.body.note, at: new Date().toISOString() }];
  await deps().prisma.manualReview.update({ where: { id: m.id }, data: { notes: notes as object } });
  await audit(actorFrom(ctx), 'review.note_added', 'ManualReview', m.id);
  return { ok: true };
});
adminRoutes.post('/reviews/:id/resolve', { summary: 'Resolve a review with a final outcome (and optional finding overrides)', guard: requireAdmin('reviews.manage'), body: reviewResolveSchema }, async (ctx) => {
  await resolveReview(uuidParam(ctx), { outcome: ctx.body.outcome as 'VERIFIED', note: ctx.body.note, findingOverrides: ctx.body.findingOverrides, requestRevisit: ctx.body.requestRevisit }, ctx.auth.user!.id, actorFrom(ctx));
  return { ok: true };
});

adminRoutes.get('/fraud', { summary: 'Fraud / risk signals', guard: requireAdmin('fraud.manage'), query: z.object({ status: z.enum(['OPEN', 'CONFIRMED_FRAUD', 'FALSE_POSITIVE']).default('OPEN'), severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional() }) }, async (ctx) =>
  deps().prisma.fraudSignal.findMany({ where: { status: ctx.query.status, ...(ctx.query.severity ? { severity: ctx.query.severity } : {}) }, orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }], take: 200, include: { request: { select: { reference: true } }, verifier: { include: { user: { select: { fullName: true } } } } } }),
);
adminRoutes.post('/fraud/:id/resolve', { summary: 'Confirm fraud or mark false positive', guard: requireAdmin('fraud.manage'), body: fraudResolveSchema }, async (ctx) => {
  const id = uuidParam(ctx);
  const s = await deps().prisma.fraudSignal.update({ where: { id }, data: { status: ctx.body.resolution, resolvedById: ctx.auth.user!.id, resolvedNote: ctx.body.note, resolvedAt: new Date() } });
  if (s.verifierId) {
    await deps().prisma.verifierProfile.update({ where: { id: s.verifierId }, data: ctx.body.resolution === 'CONFIRMED_FRAUD' ? { auditFailCount: { increment: 1 } } : { auditPassCount: { increment: 1 } } });
    await updateVerifierStats(s.verifierId);
  }
  await audit(actorFrom(ctx), `fraud.${ctx.body.resolution.toLowerCase()}`, 'FraudSignal', id, { note: ctx.body.note });
  return { ok: true };
});

adminRoutes.get('/evidence', { summary: 'Evidence browser (duplicates, GPS, timestamps)', guard: requireAdmin('reviews.manage'), query: z.object({ flagged: z.coerce.boolean().optional() }) }, async (ctx) => {
  const items = await deps().prisma.verificationEvidence.findMany({ where: ctx.query.flagged ? { OR: [{ duplicateOfId: { not: null } }, { request: { riskFlagged: true } }] } : {}, orderBy: { receivedAt: 'desc' }, take: 60, include: { request: { select: { reference: true } } } });
  return items.map((e) => ({ id: e.id, requestId: e.requestId, reference: e.request.reference, category: e.category, url: signedFileUrl(e.fileId), capturedAt: e.capturedAt, receivedAt: e.receivedAt, lat: e.lat, lng: e.lng, accuracyM: e.accuracyM, distanceFromTargetM: e.distanceFromTargetM, sha256: e.serverSha256, perceptualHash: e.perceptualHash, duplicateOfId: e.duplicateOfId, deviceId: e.deviceId }));
});

adminRoutes.get('/disputes', { summary: 'Dispute management', guard: requireAdmin('disputes.manage'), query: z.object({ status: z.enum(['OPEN', 'UNDER_REVIEW', 'UPHELD', 'REJECTED']).optional() }) }, async (ctx) =>
  deps().prisma.verificationDispute.findMany({ where: ctx.query.status ? { status: ctx.query.status } : { status: { in: ['OPEN', 'UNDER_REVIEW'] } }, orderBy: { createdAt: 'asc' }, include: { request: { select: { reference: true, status: true, outcome: true } } } }),
);
adminRoutes.post('/disputes/:id/resolve', { summary: 'Resolve a dispute (upheld disputes reopen the request for review)', guard: requireAdmin('disputes.manage'), body: disputeResolveSchema }, async (ctx) => {
  const id = uuidParam(ctx);
  await withTx(async (tx, after) => {
    const d = await tx.verificationDispute.findUnique({ where: { id }, include: { request: true } });
    if (!d) throw notFound('Dispute');
    if (['UPHELD', 'REJECTED'].includes(d.status)) throw conflict('Dispute already resolved');
    await tx.verificationDispute.update({ where: { id }, data: { status: ctx.body.decision, resolutionNote: ctx.body.resolutionNote, resolvedById: ctx.auth.user!.id, resolvedAt: new Date() } });
    if (ctx.body.decision === 'UPHELD' && ['COMPLETED', 'PARTIALLY_VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE'].includes(d.request.status)) {
      await transition(tx, after, d.requestId, 'MANUAL_REVIEW', { type: 'ADMIN', id: ctx.auth.user!.id }, { note: `Dispute upheld: ${ctx.body.resolutionNote}` });
      await tx.manualReview.create({ data: { requestId: d.requestId, trigger: 'DISPUTE', reasons: [`Dispute upheld: ${d.reason}`] } });
    }
    await audit(actorFrom(ctx), `dispute.${ctx.body.decision.toLowerCase()}`, 'VerificationDispute', id, { note: ctx.body.resolutionNote }, { organisationId: d.request.organisationId, db: tx });
    after(() => notifyUser(d.raisedByUserId, 'dispute.update', { reference: d.request.reference }, { channels: ['PUSH', 'EMAIL'] }));
  });
  return { ok: true };
});

// ─── D7 Finance (separate permissions; privileged confirmation) ──────────────
adminRoutes.get('/finance/summary', { summary: 'Finance summary', guard: requireAdmin('finance.read') }, async () => {
  const { prisma } = deps();
  const [payments, payouts, wallets] = await Promise.all([
    prisma.payment.groupBy({ by: ['status', 'purpose'], _sum: { amount: true }, _count: true }),
    prisma.payout.groupBy({ by: ['status'], _sum: { amount: true }, _count: true }),
    prisma.wallet.groupBy({ by: ['ownerType'], _sum: { availableBalance: true, pendingBalance: true, heldBalance: true } }),
  ]);
  return { payments, payouts, wallets };
});
adminRoutes.get('/finance/payments', { summary: 'All payments', guard: requireAdmin('finance.read'), query: paginationSchema.extend({ status: z.enum(['INITIATED', 'SUCCEEDED', 'FAILED', 'ABANDONED', 'REFUNDED']).optional() }) }, async (ctx) => {
  const where = ctx.query.status ? { status: ctx.query.status } : {};
  const [items, total] = await Promise.all([deps().prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (ctx.query.page - 1) * ctx.query.pageSize, take: ctx.query.pageSize, include: { organisation: { select: { legalName: true } } } }), deps().prisma.payment.count({ where })]);
  return paged(items.map((p) => ({ id: p.id, reference: p.reference, purpose: p.purpose, status: p.status, amount: p.amount.toFixed(2), currency: p.currency, provider: p.provider, organisation: p.organisation?.legalName ?? null, paidAt: p.paidAt, reconciledAt: p.reconciledAt, createdAt: p.createdAt })), total, ctx.query.page, ctx.query.pageSize);
});
adminRoutes.get('/finance/payouts', { summary: 'Payout requests', guard: requireAdmin('finance.read'), query: z.object({ status: z.enum(['REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED']).optional() }) }, async (ctx) =>
  (await deps().prisma.payout.findMany({ where: ctx.query.status ? { status: ctx.query.status } : {}, orderBy: { createdAt: 'desc' }, take: 200, include: { verifier: { include: { user: { select: { fullName: true } } } } } })).map((p) => ({
    id: p.id,
    reference: p.reference,
    verifier: p.verifier.user.fullName,
    verifierId: p.verifierId,
    amount: p.amount.toFixed(2),
    status: p.status,
    bankName: p.bankName,
    accountLast4: p.accountLast4,
    provider: p.provider,
    createdAt: p.createdAt,
    failureReason: p.failureReason,
  })),
);
adminRoutes.post('/finance/payouts/:id/decision', { summary: 'Approve or reject a payout (password confirmation)', guard: requireAdmin('payouts.approve'), body: payoutDecisionSchema }, async (ctx) => {
  await confirmPrivileged(ctx.auth.user!.id, ctx.body.confirmPassword);
  await decidePayout(uuidParam(ctx), ctx.body.decision, ctx.body.reason, ctx.auth.user!.id, actorFrom(ctx));
  return { ok: true };
});
adminRoutes.post('/finance/payments/:id/refund', { summary: 'Refund a payment (password confirmation)', guard: requireAdmin('finance.manage'), body: refundSchema }, async (ctx) => {
  await confirmPrivileged(ctx.auth.user!.id, ctx.body.confirmPassword);
  await refundPayment(uuidParam(ctx), ctx.body.reason, actorFrom(ctx));
  return { ok: true };
});
adminRoutes.post('/finance/reconcile', { summary: 'Run payment reconciliation', guard: requireAdmin('finance.manage') }, async (ctx) => {
  const r = await reconcilePayments(0);
  await audit(actorFrom(ctx), 'finance.reconciled', 'Payment', null, { reverified: r.reverified.length, mismatches: r.ledgerMismatches });
  return r;
});
adminRoutes.get('/finance/wallets', { summary: 'Wallets', guard: requireAdmin('finance.read') }, async () =>
  (await deps().prisma.wallet.findMany({ orderBy: { updatedAt: 'desc' }, take: 200, include: { organisation: { select: { legalName: true } }, verifier: { include: { user: { select: { fullName: true } } } } } })).map((w) => ({ id: w.id, ownerType: w.ownerType, owner: w.organisation?.legalName ?? w.verifier?.user.fullName ?? 'Platform', available: w.availableBalance.toFixed(2), pending: w.pendingBalance.toFixed(2), held: w.heldBalance.toFixed(2), currency: w.currency, updatedAt: w.updatedAt })),
);
adminRoutes.get('/finance/wallets/:id/transactions', { summary: 'Wallet ledger', guard: requireAdmin('finance.read') }, async (ctx) => deps().prisma.walletTransaction.findMany({ where: { walletId: uuidParam(ctx) }, orderBy: { createdAt: 'desc' }, take: 300 }));

// ─── D10 Platform configuration & pricing ────────────────────────────────────
adminRoutes.get('/config/platform', { summary: 'Platform configuration', guard: requireAdmin('overview.read') }, async () => getPlatformConfig());
adminRoutes.put('/config/platform', { summary: 'Update platform configuration (audited, password confirmation)', guard: requireAdmin('config.manage'), body: platformConfigSchema.extend({ confirmPassword: z.string().min(1) }) }, async (ctx) => {
  await confirmPrivileged(ctx.auth.user!.id, ctx.body.confirmPassword);
  const { confirmPassword: _c, ...value } = ctx.body;
  const before = await getPlatformConfig();
  if ([...value.walkingTiersMinutes].sort((a, b) => a - b).join() !== value.walkingTiersMinutes.join()) throw badRequest('Walking tiers must be ascending');
  await saveSetting('platform', value, ctx.auth.user!.id);
  await audit(actorFrom(ctx), 'config.platform_updated', 'PlatformSetting', 'platform', { before, after: value });
  return value;
});
adminRoutes.get('/pricing', { summary: 'Pricing plans', guard: requireAdmin('overview.read') }, async () => deps().prisma.pricingPlan.findMany({ orderBy: [{ countryCode: 'asc' }, { audience: 'asc' }, { level: 'asc' }] }));
adminRoutes.put('/pricing', { summary: 'Create or update a pricing plan (audited)', guard: requireAdmin('finance.manage'), body: pricingPlanSchema }, async (ctx) => {
  const b = ctx.body;
  const before = await deps().prisma.pricingPlan.findUnique({ where: { countryCode_level_audience: { countryCode: b.countryCode, level: b.level, audience: b.audience } } });
  const data = { price: new Prisma.Decimal(b.price), verifierReward: new Prisma.Decimal(b.verifierReward), bulkThreshold: b.bulkThreshold, bulkPrice: b.bulkPrice ? new Prisma.Decimal(b.bulkPrice) : null, slaHours: b.slaHours, active: b.active };
  const plan = await deps().prisma.pricingPlan.upsert({ where: { countryCode_level_audience: { countryCode: b.countryCode, level: b.level, audience: b.audience } }, create: { countryCode: b.countryCode, level: b.level, audience: b.audience, ...data }, update: data });
  await audit(actorFrom(ctx), 'pricing.updated', 'PricingPlan', plan.id, { before: before ? { price: before.price.toString(), reward: before.verifierReward.toString() } : null, after: b });
  return plan;
});
adminRoutes.get('/notification-templates', { summary: 'Notification template overrides', guard: requireAdmin('config.manage') }, async () => deps().prisma.notificationTemplate.findMany({ orderBy: { key: 'asc' } }));
adminRoutes.put('/notification-templates', { summary: 'Override a notification template', guard: requireAdmin('config.manage'), body: z.object({ key: z.string().min(3).max(60), channel: z.enum(['IN_APP', 'EMAIL', 'SMS', 'PUSH']), subject: z.string().max(200).optional(), body: z.string().min(3).max(1000) }) }, async (ctx) => {
  const t = await deps().prisma.notificationTemplate.upsert({ where: { key_channel: { key: ctx.body.key, channel: ctx.body.channel } }, create: ctx.body, update: { subject: ctx.body.subject, body: ctx.body.body } });
  await audit(actorFrom(ctx), 'config.template_updated', 'NotificationTemplate', t.id, ctx.body);
  return t;
});

// ─── D8 Geography ────────────────────────────────────────────────────────────
adminRoutes.get('/geo/countries', { summary: 'Countries', guard: requireAdmin('geo.manage') }, async () => deps().prisma.country.findMany({ orderBy: { name: 'asc' } }));
adminRoutes.put('/geo/countries', { summary: 'Create or update a country', guard: requireAdmin('geo.manage'), body: countrySchema }, async (ctx) => {
  const c = await deps().prisma.country.upsert({ where: { code: ctx.body.code }, create: ctx.body, update: ctx.body });
  await audit(actorFrom(ctx), 'geo.country_saved', 'Country', c.code, ctx.body);
  return c;
});
adminRoutes.get('/geo/areas', { summary: 'Administrative areas with verifier density', guard: requireAdmin('geo.manage'), query: z.object({ countryCode: z.string().length(2).default('NG') }) }, async (ctx) => {
  const areas = await deps().prisma.administrativeArea.findMany({ where: { countryCode: ctx.query.countryCode }, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
  const density = await deps().prisma.$queryRaw<Array<{ id: string; verifiers: number }>>`
    SELECT ar.id, count(va.id)::int AS verifiers FROM "AdministrativeArea" ar
    LEFT JOIN "VerifierAvailability" va ON ar."centerLat" IS NOT NULL AND va."lastLat" IS NOT NULL
      AND ST_DWithin(va.location, ST_SetSRID(ST_MakePoint(ar."centerLng", ar."centerLat"), 4326)::geography, 5000)
    WHERE ar."countryCode" = ${ctx.query.countryCode} GROUP BY ar.id`;
  return areas.map((a) => ({ ...a, verifiersWithin5km: density.find((d) => d.id === a.id)?.verifiers ?? 0 }));
});
adminRoutes.put('/geo/areas', { summary: 'Create or update an administrative area / service coverage', guard: requireAdmin('geo.manage'), body: areaSchema.extend({ id: z.string().uuid().optional() }) }, async (ctx) => {
  const { id, ...data } = ctx.body;
  const a = id ? await deps().prisma.administrativeArea.update({ where: { id }, data }) : await deps().prisma.administrativeArea.create({ data });
  await audit(actorFrom(ctx), 'geo.area_saved', 'AdministrativeArea', a.id, data);
  return a;
});

// ─── D9 AI administration ────────────────────────────────────────────────────
adminRoutes.get('/ai', { summary: 'AI configuration, provider status and spend', guard: requireAdmin('ai.manage') }, async () => {
  const { prisma, ai, env } = deps();
  const [cfg, spend, usage, history] = await Promise.all([
    getAiConfig(),
    monthSpendUsd(),
    prisma.aiUsageRecord.groupBy({ by: ['feature', 'model'], _sum: { inputTokens: true, outputTokens: true, images: true, costUsd: true }, _count: true, where: { createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } } }),
    prisma.aiAnalysis.findMany({ orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, feature: true, subjectType: true, model: true, promptVersion: true, status: true, confidence: true, nextAction: true, error: true, latencyMs: true, createdAt: true } }),
  ]);
  return { provider: ai.name, providerConfigured: ai.enabled, defaultModels: { text: env.AI_MODEL_TEXT, vision: env.AI_MODEL_VISION }, config: cfg, monthSpendUsd: Number(spend.toFixed(4)), usage, history };
});
adminRoutes.put('/ai', { summary: 'Update AI configuration (password confirmation)', guard: requireAdmin('ai.manage'), body: aiConfigSchema.extend({ confirmPassword: z.string().min(1) }) }, async (ctx) => {
  await confirmPrivileged(ctx.auth.user!.id, ctx.body.confirmPassword);
  const { confirmPassword: _c, ...value } = ctx.body;
  await saveSetting('ai', value, ctx.auth.user!.id);
  await audit(actorFrom(ctx), 'config.ai_updated', 'PlatformSetting', 'ai', value);
  return value;
});

// ─── Audit & privacy ─────────────────────────────────────────────────────────
adminRoutes.get('/audit', { summary: 'Audit log', guard: requireAdmin('audit.read'), query: paginationSchema.extend({ action: z.string().max(80).optional(), entityType: z.string().max(60).optional(), entityId: z.string().max(60).optional(), actorUserId: z.string().uuid().optional() }) }, async (ctx) => {
  const q = ctx.query;
  const where: Prisma.AuditEventWhereInput = { ...(q.action ? { action: { startsWith: q.action } } : {}), ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.entityId ? { entityId: q.entityId } : {}), ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}) };
  const [items, total] = await Promise.all([deps().prisma.auditEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }), deps().prisma.auditEvent.count({ where })]);
  return paged(items, total, q.page, q.pageSize);
});
adminRoutes.get('/data-requests', { summary: 'Data-subject requests', guard: requireAdmin('users.manage') }, async () => deps().prisma.dataSubjectRequest.findMany({ orderBy: { createdAt: 'desc' }, include: { user: { select: { fullName: true, email: true, phone: true } } } }));
adminRoutes.post('/data-requests/:id/resolve', { summary: 'Resolve a data-subject request', guard: requireAdmin('users.manage'), body: z.object({ status: z.enum(['COMPLETED', 'REJECTED']), note: z.string().min(3).max(1000) }) }, async (ctx) => {
  const d = await deps().prisma.dataSubjectRequest.update({ where: { id: uuidParam(ctx) }, data: { status: ctx.body.status, resolvedAt: new Date(), resolvedById: ctx.auth.user!.id } });
  await audit(actorFrom(ctx), 'privacy.dsr_resolved', 'DataSubjectRequest', d.id, ctx.body);
  return d;
});
