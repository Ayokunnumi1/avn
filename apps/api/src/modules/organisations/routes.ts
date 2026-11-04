import { z } from 'zod';
import { hashPassword, issueToken } from '@avn/auth';
import { memberInviteSchema, memberRoleSchema, organisationRegisterSchema, policyCreateSchema, policyVersionSchema, paginationSchema, FINAL_REQUEST_STATUSES } from '@avn/contracts';
import { Prisma } from '@avn/database';
import { normalisePhone } from '@avn/shared-utils';
import { deps } from '../../container';
import { actorFrom, audit } from '../../lib/audit';
import { requireOrg } from '../../lib/auth';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { paged, routes, uuidParam } from '../../lib/http';
import { ensureWallet } from '../../lib/ledger';
import { sendDirect } from '../../lib/notify';
import { consume } from '../../lib/rate-limit';
import { withTx } from '../../lib/tx';
import { createSession, passwordResetHash } from '../auth/service';

export const orgRoutes = routes('/org', 'Institutions');

orgRoutes.post('/register', { summary: 'Register an organisation (pending platform approval)', body: organisationRegisterSchema, public: true }, async (ctx, _req, res) => {
  await consume('org-register', ctx.ip, 5, 3600);
  const b = ctx.body;
  const phone = normalisePhone(b.contactPhone, b.countryCode);
  const repPhone = normalisePhone(b.representative.phone, b.countryCode);
  if (!phone || !repPhone) throw badRequest('Enter valid phone numbers');
  const { prisma } = deps();
  const exists = await prisma.user.findUnique({ where: { accountType_email: { accountType: 'INSTITUTION', email: b.representative.email } } });
  if (exists) throw conflict('A user with this email already exists');
  const { org, user } = await withTx(async (tx) => {
    const org = await tx.organisation.create({
      data: {
        legalName: b.legalName,
        tradingName: b.tradingName,
        registrationNumber: b.registrationNumber,
        businessType: b.businessType,
        countryCode: b.countryCode,
        contactEmail: b.contactEmail,
        contactPhone: phone,
        address: b.address,
        website: b.website,
        expectedMonthlyVolume: b.expectedMonthlyVolume,
        verificationRequirements: b.verificationRequirements,
      },
    });
    const user = await tx.user.create({
      data: { accountType: 'INSTITUTION', fullName: b.representative.fullName, email: b.representative.email, phone: repPhone, passwordHash: await hashPassword(b.representative.password), countryCode: b.countryCode },
    });
    await tx.organisationMember.create({ data: { organisationId: org.id, userId: user.id, role: 'OWNER', jobTitle: b.representative.jobTitle } });
    await ensureWallet(tx, 'ORGANISATION', org.id);
    const platformDefault = await tx.verificationPolicy.findFirst({ where: { organisationId: null, isDefault: true }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
    if (platformDefault?.versions[0]) {
      await tx.verificationPolicy.create({
        data: { organisationId: org.id, name: 'Standard residential', level: 'STANDARD', isDefault: true, versions: { create: { version: 1, rules: platformDefault.versions[0].rules as object, changeNote: 'Copied from platform default' } } },
      });
    }
    await audit(actorFrom(ctx), 'org.registered', 'Organisation', org.id, { legalName: b.legalName }, { organisationId: org.id, db: tx });
    return { org, user };
  });
  await createSession(res, user, 'business', { ip: ctx.ip, userAgent: ctx.userAgent });
  res.status(201);
  return { id: org.id, status: org.status };
});

orgRoutes.get('/', { summary: 'Organisation profile, status and wallet', guard: requireOrg('requests.read', { allowPending: true }) }, async (ctx) => {
  const org = await deps().prisma.organisation.findUniqueOrThrow({ where: { id: ctx.auth.org!.id }, include: { wallet: true } });
  return {
    id: org.id,
    legalName: org.legalName,
    tradingName: org.tradingName,
    registrationNumber: org.registrationNumber,
    businessType: org.businessType,
    countryCode: org.countryCode,
    contactEmail: org.contactEmail,
    contactPhone: org.contactPhone,
    address: org.address,
    status: org.status,
    decisionReason: org.decisionReason,
    postpaidEnabled: org.postpaidEnabled,
    creditLimit: org.creditLimit.toFixed(2),
    wallet: org.wallet ? { available: org.wallet.availableBalance.toFixed(2), currency: org.wallet.currency } : null,
  };
});

orgRoutes.get('/dashboard', { summary: 'Institutional dashboard metrics (spec C4)', guard: requireOrg('requests.read', { allowPending: true }) }, async (ctx) => {
  const { prisma } = deps();
  const orgId = ctx.auth.org!.id;
  const w = { organisationId: orgId };
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [byStatus, byOutcome, spend, turnaround, trend] = await Promise.all([
    prisma.verificationRequest.groupBy({ by: ['status'], where: w, _count: true }),
    prisma.verificationRequest.groupBy({ by: ['outcome'], where: { ...w, outcome: { not: null } }, _count: true }),
    prisma.walletTransaction.aggregate({ where: { wallet: { organisationId: orgId }, category: 'VERIFICATION_CHARGE', createdAt: { gte: monthStart } }, _sum: { amount: true } }),
    prisma.$queryRaw<Array<{ hours: number | null }>>`SELECT avg(extract(epoch from ("outcomeAt" - "createdAt")) / 3600)::float AS hours FROM "VerificationRequest" WHERE "organisationId" = ${orgId}::uuid AND "outcomeAt" IS NOT NULL`,
    prisma.$queryRaw<Array<{ day: Date; n: number }>>`SELECT date_trunc('day', "createdAt") AS day, count(*)::int AS n FROM "VerificationRequest" WHERE "organisationId" = ${orgId}::uuid AND "createdAt" > now() - interval '30 days' GROUP BY 1 ORDER BY 1`,
  ]);
  const count = (...s: string[]) => byStatus.filter((b) => s.includes(b.status)).reduce((n, b) => n + b._count, 0);
  const reviewsPending = await prisma.verificationDispute.count({ where: { request: w, status: { in: ['OPEN', 'UNDER_REVIEW'] } } });
  return {
    totalRequests: byStatus.reduce((n, b) => n + b._count, 0),
    pendingApplicantSubmissions: count('CREATED', 'AWAITING_APPLICANT'),
    awaitingVerifierAssignment: count('READY_FOR_ASSIGNMENT', 'DISPATCHING', 'ASSIGNED'),
    inProgressVisits: count('ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'VISIT_IN_PROGRESS', 'EVIDENCE_SUBMITTED', 'PROCESSING'),
    completedVerifications: count('COMPLETED', 'PARTIALLY_VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE'),
    reportsRequiringReview: count('MANUAL_REVIEW') + reviewsPending,
    failedOrCancelled: count('CANCELLED', 'EXPIRED', 'NOT_VERIFIED'),
    monthlyExpenditure: spend._sum.amount?.toFixed(2) ?? '0.00',
    averageTurnaroundHours: turnaround[0]?.hours != null ? Math.round(turnaround[0].hours * 10) / 10 : null,
    outcomeStatistics: byOutcome.map((o) => ({ outcome: o.outcome, count: o._count })),
    statusBreakdown: byStatus.map((b) => ({ status: b.status, count: b._count })),
    dailyVolume: trend.map((t) => ({ day: t.day, count: t.n })),
  };
});

// ─── Team & roles ────────────────────────────────────────────────────────────
orgRoutes.get('/members', { summary: 'Organisation members and roles', guard: requireOrg('requests.read') }, async (ctx) => {
  const members = await deps().prisma.organisationMember.findMany({ where: { organisationId: ctx.auth.org!.id }, include: { user: { select: { fullName: true, email: true, lastLoginAt: true, mfaEnabled: true, status: true } } }, orderBy: { createdAt: 'asc' } });
  return members.map((m) => ({ ...m.user, userStatus: m.user.status, id: m.id, role: m.role, status: m.status, jobTitle: m.jobTitle, department: m.department }));
});

orgRoutes.post('/members', { summary: 'Invite a staff member with a role', guard: requireOrg('team.manage'), body: memberInviteSchema }, async (ctx) => {
  if (ctx.body.role === 'OWNER' && ctx.auth.org!.role !== 'OWNER') throw forbidden('Only owners can add owners');
  const { prisma, env } = deps();
  const exists = await prisma.user.findUnique({ where: { accountType_email: { accountType: 'INSTITUTION', email: ctx.body.email } } });
  if (exists) throw conflict('This email already belongs to an institution user');
  const { raw } = issueToken(env.SESSION_SECRET);
  const user = await prisma.user.create({
    data: {
      accountType: 'INSTITUTION',
      fullName: ctx.body.fullName,
      email: ctx.body.email,
      membership: { create: { organisationId: ctx.auth.org!.id, role: ctx.body.role, invitedById: ctx.auth.user!.id } },
      passwordResets: { create: { tokenHash: passwordResetHash(raw), expiresAt: new Date(Date.now() + 72 * 3600_000) } },
    },
  });
  const link = `${env.BUSINESS_APP_URL}/reset-password?token=${raw}&welcome=1`;
  await sendDirect('EMAIL', ctx.body.email, 'org.member_invite', { link });
  await audit(actorFrom(ctx), 'org.member_invited', 'User', user.id, { role: ctx.body.role, email: ctx.body.email });
  return { id: user.id, ...(env.OTP_DEV_ECHO && env.APP_ENV !== 'production' ? { devInviteLink: link } : {}) };
});

orgRoutes.patch('/members/:id', { summary: 'Change a member role', guard: requireOrg('team.manage'), body: memberRoleSchema }, async (ctx) => {
  const { prisma } = deps();
  const m = await prisma.organisationMember.findFirst({ where: { id: uuidParam(ctx), organisationId: ctx.auth.org!.id } });
  if (!m) throw notFound('Member');
  if ((m.role === 'OWNER' || ctx.body.role === 'OWNER') && ctx.auth.org!.role !== 'OWNER') throw forbidden('Only owners can change ownership');
  if (m.role === 'OWNER' && ctx.body.role !== 'OWNER') {
    const owners = await prisma.organisationMember.count({ where: { organisationId: m.organisationId, role: 'OWNER', status: 'ACTIVE' } });
    if (owners <= 1) throw conflict('An organisation must keep at least one owner');
  }
  await prisma.organisationMember.update({ where: { id: m.id }, data: { role: ctx.body.role } });
  await audit(actorFrom(ctx), 'org.member_role_changed', 'OrganisationMember', m.id, { from: m.role, to: ctx.body.role });
  return { ok: true };
});

orgRoutes.delete('/members/:id', { summary: 'Remove a member (revokes their sessions)', guard: requireOrg('team.manage') }, async (ctx) => {
  const { prisma } = deps();
  const m = await prisma.organisationMember.findFirst({ where: { id: uuidParam(ctx), organisationId: ctx.auth.org!.id } });
  if (!m) throw notFound('Member');
  if (m.userId === ctx.auth.user!.id) throw badRequest('You cannot remove yourself');
  if (m.role === 'OWNER') throw conflict('Transfer ownership before removing an owner');
  await prisma.$transaction([
    prisma.organisationMember.update({ where: { id: m.id }, data: { status: 'DEACTIVATED' } }),
    prisma.user.update({ where: { id: m.userId }, data: { status: 'DEACTIVATED' } }),
    prisma.userSession.updateMany({ where: { userId: m.userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'member_removed' } }),
  ]);
  await audit(actorFrom(ctx), 'org.member_removed', 'OrganisationMember', m.id);
  return { ok: true };
});

// ─── Versioned verification policies (spec C9) ───────────────────────────────
orgRoutes.get('/policies', { summary: 'Verification policies with version history', guard: requireOrg('policies.read') }, async (ctx) => {
  const list = await deps().prisma.verificationPolicy.findMany({ where: { organisationId: ctx.auth.org!.id, archived: false }, include: { versions: { orderBy: { version: 'desc' } } }, orderBy: { createdAt: 'asc' } });
  return list.map((p) => ({ id: p.id, name: p.name, description: p.description, level: p.level, isDefault: p.isDefault, currentVersion: p.currentVersion, versions: p.versions.map((v) => ({ version: v.version, rules: v.rules, changeNote: v.changeNote, createdAt: v.createdAt })) }));
});

orgRoutes.post('/policies', { summary: 'Create a verification policy', guard: requireOrg('policies.manage'), body: policyCreateSchema }, async (ctx) => {
  const p = await deps().prisma.verificationPolicy.create({
    data: { organisationId: ctx.auth.org!.id, name: ctx.body.name, description: ctx.body.description, level: ctx.body.level, versions: { create: { version: 1, rules: ctx.body.rules, createdById: ctx.auth.user!.id, changeNote: 'Initial version' } } },
  });
  await audit(actorFrom(ctx), 'policy.created', 'VerificationPolicy', p.id, { rules: ctx.body.rules });
  return { id: p.id };
});

orgRoutes.post('/policies/:id/versions', { summary: 'Publish a new policy version (existing requests keep their frozen version)', guard: requireOrg('policies.manage'), body: policyVersionSchema }, async (ctx) => {
  const id = uuidParam(ctx);
  const v = await withTx(async (tx) => {
    const p = await tx.verificationPolicy.findFirst({ where: { id, organisationId: ctx.auth.org!.id } });
    if (!p) throw notFound('Policy');
    const version = p.currentVersion + 1;
    await tx.verificationPolicyVersion.create({ data: { policyId: p.id, version, rules: ctx.body.rules, changeNote: ctx.body.changeNote, createdById: ctx.auth.user!.id } });
    await tx.verificationPolicy.update({ where: { id: p.id }, data: { currentVersion: version } });
    await audit(actorFrom(ctx), 'policy.versioned', 'VerificationPolicy', p.id, { version, changeNote: ctx.body.changeNote }, { db: tx });
    return version;
  });
  return { version: v };
});

orgRoutes.post('/policies/:id/default', { summary: 'Make a policy the organisation default', guard: requireOrg('policies.manage') }, async (ctx) => {
  const id = uuidParam(ctx);
  const { prisma } = deps();
  const p = await prisma.verificationPolicy.findFirst({ where: { id, organisationId: ctx.auth.org!.id } });
  if (!p) throw notFound('Policy');
  await prisma.$transaction([
    prisma.verificationPolicy.updateMany({ where: { organisationId: ctx.auth.org!.id }, data: { isDefault: false } }),
    prisma.verificationPolicy.update({ where: { id }, data: { isDefault: true } }),
  ]);
  await audit(actorFrom(ctx), 'policy.default_set', 'VerificationPolicy', id);
  return { ok: true };
});

orgRoutes.get('/audit', { summary: 'Organisation audit trail', guard: requireOrg('audit.read'), query: paginationSchema.extend({ action: z.string().max(80).optional() }) }, async (ctx) => {
  const where = { organisationId: ctx.auth.org!.id, ...(ctx.query.action ? { action: { startsWith: ctx.query.action } } : {}) };
  const [items, total] = await Promise.all([
    deps().prisma.auditEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (ctx.query.page - 1) * ctx.query.pageSize, take: ctx.query.pageSize }),
    deps().prisma.auditEvent.count({ where }),
  ]);
  return paged(items.map((e) => ({ id: e.id, action: e.action, entityType: e.entityType, entityId: e.entityId, actorType: e.actorType, actorLabel: e.actorLabel, ipAddress: e.ipAddress, metadata: e.metadata, createdAt: e.createdAt })), total, ctx.query.page, ctx.query.pageSize);
});

export const ACTIVE_STATUSES_FILTER = { notIn: [...FINAL_REQUEST_STATUSES] };
export const decimal = (v: string) => new Prisma.Decimal(v);
