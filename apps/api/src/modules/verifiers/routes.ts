import { z } from 'zod';
import { hashPassword } from '@avn/auth';
import { availabilitySchema, heartbeatSchema, payoutAccountSchema, payoutRequestSchema, verifierIdentitySchema, verifierRegisterSchema } from '@avn/contracts';
import { Prisma } from '@avn/database';
import { normalisePhone } from '@avn/shared-utils';
import { coarsen } from '@avn/shared-utils/geo';
import { encryptField, reference } from '@avn/shared-utils/crypto';
import { Decimal } from '@avn/shared-utils/money';
import { IMAGE_MIME, DOCUMENT_MIME } from '@avn/storage';
import { deps } from '../../container';
import { actorFrom, audit } from '../../lib/audit';
import { requireVerifier } from '../../lib/auth';
import { AppError, badRequest, conflict, forbidden } from '../../lib/errors';
import { storeFile, upload } from '../../lib/files';
import { routes } from '../../lib/http';
import { enqueue } from '../../lib/jobs';
import { ensureWallet, moveBetweenBuckets } from '../../lib/ledger';
import { consume } from '../../lib/rate-limit';
import { getPlatformConfig } from '../../lib/settings';
import { withTx } from '../../lib/tx';
import { createSession } from '../auth/service';
import { identityProvider } from './identity';

export const verifierRoutes = routes('/verifiers', 'Verifiers');

verifierRoutes.post('/register', { summary: 'Register as a field verifier', body: verifierRegisterSchema, public: true }, async (ctx, _req, res) => {
  await consume('verifier-register', ctx.ip, 10, 3600);
  const phone = normalisePhone(ctx.body.phone);
  if (!phone) throw badRequest('Enter a valid phone number');
  const { prisma } = deps();
  const exists = await prisma.user.findFirst({ where: { accountType: 'VERIFIER', OR: [{ email: ctx.body.email }, { phone }] } });
  if (exists) throw conflict('A verifier account with this email or phone already exists');
  const user = await prisma.user.create({
    data: {
      accountType: 'VERIFIER',
      fullName: ctx.body.fullName,
      email: ctx.body.email,
      phone,
      passwordHash: await hashPassword(ctx.body.password),
      verifierProfile: {
        create: { dateOfBirth: ctx.body.dateOfBirth, residentialAddress: ctx.body.residentialAddress, homeLat: ctx.body.homeLat, homeLng: ctx.body.homeLng },
      },
    },
    include: { verifierProfile: true },
  });
  await withTx((tx) => ensureWallet(tx, 'VERIFIER', user.verifierProfile!.id));
  await createSession(res, user, 'verifier', { ip: ctx.ip, userAgent: ctx.userAgent });
  await audit(actorFrom(ctx), 'verifier.registered', 'VerifierProfile', user.verifierProfile!.id);
  res.status(201);
  return { id: user.verifierProfile!.id, status: user.verifierProfile!.status };
});

verifierRoutes.post('/me/photo', { summary: 'Upload profile photograph (camera capture)', guard: requireVerifier(), upload: upload('file') }, async (ctx) => {
  if (!ctx.file) throw badRequest('Attach a photo');
  const file = await storeFile({ data: ctx.file.buffer, allowed: IMAGE_MIME, purpose: 'verifier-photo', ownerUserId: ctx.auth.user!.id });
  await deps().prisma.verifierProfile.update({ where: { id: ctx.auth.verifier!.id }, data: { photoFileId: file.id } });
  return { ok: true };
});

verifierRoutes.post(
  '/me/identity',
  { summary: 'Submit government identity details with ID document and selfie', guard: requireVerifier(), upload: upload('files', 2), body: verifierIdentitySchema },
  async (ctx) => {
    const { prisma, env } = deps();
    const v = await prisma.verifierProfile.findUniqueOrThrow({ where: { id: ctx.auth.verifier!.id }, include: { user: true } });
    if (['APPROVED', 'SUSPENDED'].includes(v.status)) throw conflict('Identity is already verified');
    const [idDoc, selfie] = ctx.files;
    if (!idDoc) throw badRequest('Upload a photo of your ID document');
    const idFile = await storeFile({ data: idDoc.buffer, allowed: DOCUMENT_MIME, purpose: 'identity', ownerUserId: v.userId });
    const selfieFile = selfie ? await storeFile({ data: selfie.buffer, allowed: IMAGE_MIME, purpose: 'identity', ownerUserId: v.userId }) : null;
    const provider = identityProvider();
    let result;
    try {
      result = await provider.check({ idType: ctx.body.idType, idNumber: ctx.body.idNumber, fullName: v.user.fullName, dateOfBirth: v.dateOfBirth });
    } catch (err) {
      result = { status: 'ERROR' as const, summary: { error: String(err) } };
    }
    // Never invent success: anything other than an explicit PASS goes to a human.
    const nextStatus = result.status === 'FAILED' ? 'IDENTITY_PENDING' : 'MANUAL_REVIEW';
    await prisma.$transaction([
      prisma.verifierIdentityCheck.create({
        data: {
          verifierId: v.id,
          provider: provider.name,
          idType: ctx.body.idType,
          status: result.status === 'PASSED' ? 'PASSED' : result.status === 'FAILED' ? 'FAILED' : result.status === 'ERROR' ? 'ERROR' : 'MANUAL_REVIEW',
          providerReference: result.providerReference,
          resultSummary: result.summary as object,
          idDocumentFileId: idFile.id,
          selfieFileId: selfieFile?.id,
          completedAt: new Date(),
        },
      }),
      prisma.verifierProfile.update({
        where: { id: v.id },
        data: { idType: ctx.body.idType, idNumberEnc: encryptField(ctx.body.idNumber, env.DATA_ENCRYPTION_KEY), idNumberLast4: ctx.body.idNumber.slice(-4), status: nextStatus },
      }),
    ]);
    await audit(actorFrom(ctx), 'verifier.identity_submitted', 'VerifierProfile', v.id, { provider: provider.name, result: result.status });
    return { status: nextStatus, identityResult: result.status, provider: provider.name };
  },
);

verifierRoutes.put('/me/payout-account', { summary: 'Set Nigerian bank payout account', guard: requireVerifier(), body: payoutAccountSchema }, async (ctx) => {
  const { prisma, env, payouts } = deps();
  let recipientCode: string;
  try {
    recipientCode = (await payouts.createRecipient({ name: ctx.body.accountName, accountNumber: ctx.body.accountNumber, bankCode: ctx.body.bankCode })).recipientCode;
  } catch (err) {
    throw new AppError(502, 'PROVIDER_UNAVAILABLE', `Could not validate the bank account: ${err instanceof Error ? err.message : 'provider error'}`);
  }
  await prisma.verifierProfile.update({
    where: { id: ctx.auth.verifier!.id },
    data: {
      payoutBankCode: ctx.body.bankCode,
      payoutBankName: ctx.body.bankName,
      payoutAccountEnc: encryptField(ctx.body.accountNumber, env.DATA_ENCRYPTION_KEY),
      payoutAccountLast4: ctx.body.accountNumber.slice(-4),
      payoutAccountName: ctx.body.accountName,
      payoutRecipientCode: recipientCode,
    },
  });
  await audit(actorFrom(ctx), 'verifier.payout_account_set', 'VerifierProfile', ctx.auth.verifier!.id, { bank: ctx.body.bankName, last4: ctx.body.accountNumber.slice(-4) });
  return { ok: true };
});

verifierRoutes.get('/banks', { summary: 'Supported payout banks', guard: requireVerifier() }, async () => deps().payouts.listBanks());

verifierRoutes.get('/me', { summary: 'Verifier dashboard: status, availability, earnings, reliability', guard: requireVerifier() }, async (ctx) => {
  const { prisma } = deps();
  const cfg = await getPlatformConfig();
  const v = await prisma.verifierProfile.findUniqueOrThrow({
    where: { id: ctx.auth.verifier!.id },
    include: { availability: true, wallet: true, identityChecks: { orderBy: { createdAt: 'desc' }, take: 1 }, user: { select: { fullName: true, phone: true, email: true } } },
  });
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [todayCompleted, offers, recent, totalEarned] = await Promise.all([
    prisma.verificationAssignment.count({ where: { verifierId: v.id, status: 'SUBMITTED', submittedAt: { gte: startOfDay } } }),
    prisma.assignmentInvitation.count({ where: { verifierId: v.id, status: 'SENT', expiresAt: { gt: new Date() } } }),
    prisma.verificationAssignment.findMany({ where: { verifierId: v.id }, orderBy: { acceptedAt: 'desc' }, take: 5, include: { request: { select: { reference: true, status: true, address: { select: { district: true, city: true } } } } } }),
    prisma.walletTransaction.aggregate({ where: { walletId: v.wallet?.id ?? '00000000-0000-0000-0000-000000000000', category: 'VERIFICATION_EARNING', direction: 'CREDIT' }, _sum: { amount: true } }),
  ]);
  const a = v.availability;
  const fresh = !!a?.isAvailable && !!a.lastHeartbeatAt && Date.now() - a.lastHeartbeatAt.getTime() < cfg.heartbeatExpirySeconds * 1000;
  return {
    id: v.id,
    fullName: v.user.fullName,
    status: v.status,
    decisionReason: v.decisionReason,
    identity: v.identityChecks[0] ? { status: v.identityChecks[0].status, provider: v.identityChecks[0].provider, at: v.identityChecks[0].createdAt } : null,
    onboarding: { photo: !!v.photoFileId, identity: !!v.idNumberLast4, payoutAccount: !!v.payoutRecipientCode },
    payoutAccount: v.payoutAccountLast4 ? { bankName: v.payoutBankName, last4: v.payoutAccountLast4, accountName: v.payoutAccountName } : null,
    availability: {
      available: !!a?.isAvailable && fresh,
      sessionId: a?.isAvailable ? a.sessionId : null,
      // Stale coordinates are never presented as live.
      locationSharing: fresh ? 'LIVE' : a?.isAvailable ? 'STALE' : 'OFF',
      lastHeartbeatAt: a?.lastHeartbeatAt ?? null,
      heartbeatExpirySeconds: cfg.heartbeatExpirySeconds,
    },
    nearbyOffers: offers,
    todayCompleted,
    wallet: { pending: v.wallet?.pendingBalance.toFixed(2) ?? '0.00', available: v.wallet?.availableBalance.toFixed(2) ?? '0.00', held: v.wallet?.heldBalance.toFixed(2) ?? '0.00', totalEarned: totalEarned._sum.amount?.toFixed(2) ?? '0.00', currency: v.wallet?.currency ?? 'NGN' },
    reliabilityScore: v.reliabilityScore.toFixed(1),
    recentAssignments: recent.map((r) => ({ id: r.id, reference: r.request.reference, status: r.status, requestStatus: r.request.status, area: [r.request.address?.district, r.request.address?.city].filter(Boolean).join(', '), acceptedAt: r.acceptedAt, reward: r.reward.toFixed(2) })),
  };
});

verifierRoutes.post('/me/availability', { summary: 'Go available (starts an active-duty session) or unavailable', guard: requireVerifier({ approved: true }), body: availabilitySchema }, async (ctx) => {
  const { prisma } = deps();
  const verifierId = ctx.auth.verifier!.id;
  if (ctx.body.available) {
    if (ctx.body.lat == null || ctx.body.lng == null || ctx.body.accuracyM == null) throw badRequest('A current GPS location is required to go available');
    const sessionId = crypto.randomUUID();
    const now = new Date();
    await prisma.$transaction([
      prisma.verifierAvailability.upsert({
        where: { verifierId },
        create: { verifierId, isAvailable: true, sessionId, startedAt: now, lastHeartbeatAt: now, lastLat: ctx.body.lat, lastLng: ctx.body.lng, lastAccuracyM: ctx.body.accuracyM },
        update: { isAvailable: true, sessionId, startedAt: now, lastHeartbeatAt: now, lastLat: ctx.body.lat, lastLng: ctx.body.lng, lastAccuracyM: ctx.body.accuracyM, endedReason: null },
      }),
      prisma.verifierLocation.create({ data: { verifierId, lat: ctx.body.lat, lng: ctx.body.lng, accuracyM: ctx.body.accuracyM, recordedAt: now, availabilityState: true, sessionId } }),
    ]);
    await audit(actorFrom(ctx), 'verifier.available', 'VerifierProfile', verifierId);
    await enqueue('maintenance.tick', { only: 'redispatch' });
    return { available: true, sessionId };
  }
  // Going unavailable stops collection and clears the last position.
  await prisma.verifierAvailability.upsert({
    where: { verifierId },
    create: { verifierId, isAvailable: false, endedReason: 'USER' },
    update: { isAvailable: false, sessionId: null, lastLat: null, lastLng: null, lastAccuracyM: null, endedReason: 'USER' },
  });
  await prisma.assignmentInvitation.updateMany({ where: { verifierId, status: 'SENT' }, data: { status: 'WITHDRAWN' } });
  await audit(actorFrom(ctx), 'verifier.unavailable', 'VerifierProfile', verifierId);
  return { available: false };
});

verifierRoutes.post('/me/heartbeat', { summary: 'Foreground location heartbeat while on duty', guard: requireVerifier({ approved: true }), body: heartbeatSchema }, async (ctx) => {
  const { prisma } = deps();
  await consume('heartbeat', ctx.auth.verifier!.id, 30, 60);
  const verifierId = ctx.auth.verifier!.id;
  const a = await prisma.verifierAvailability.findUnique({ where: { verifierId } });
  if (!a?.isAvailable || a.sessionId !== ctx.body.sessionId) throw new AppError(409, 'DUTY_SESSION_ENDED', 'Your active-duty session has ended. Go available again.');
  const now = new Date();
  await prisma.$transaction([
    prisma.verifierAvailability.update({ where: { verifierId }, data: { lastHeartbeatAt: now, lastLat: ctx.body.lat, lastLng: ctx.body.lng, lastAccuracyM: ctx.body.accuracyM } }),
    prisma.verifierLocation.create({ data: { verifierId, lat: ctx.body.lat, lng: ctx.body.lng, accuracyM: ctx.body.accuracyM, recordedAt: ctx.body.recordedAt ?? now, availabilityState: true, sessionId: ctx.body.sessionId } }),
  ]);
  const cfg = await getPlatformConfig();
  const offers = await prisma.assignmentInvitation.count({ where: { verifierId, status: 'SENT', expiresAt: { gt: now } } });
  return { ok: true, expiresAt: new Date(now.getTime() + cfg.heartbeatExpirySeconds * 1000), offers };
});

verifierRoutes.get('/me/offers', { summary: 'Live job offers near you (limited details before acceptance)', guard: requireVerifier({ approved: true }) }, async (ctx) => {
  const offers = await deps().prisma.assignmentInvitation.findMany({
    where: { verifierId: ctx.auth.verifier!.id, status: 'SENT', expiresAt: { gt: new Date() } },
    include: { request: { select: { level: true, deadline: true, currency: true, priority: true, address: { select: { district: true, city: true, state: true, lat: true, lng: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  return offers.map((o) => ({
    id: o.id,
    generalLocation: [o.request.address?.district, o.request.address?.city, o.request.address?.state].filter(Boolean).join(', '),
    approxPoint: o.request.address ? coarsen({ lat: o.request.address.lat, lng: o.request.address.lng }) : null,
    walkingMinutes: Number(o.walkingMinutes),
    distanceM: o.distanceM,
    routingSource: o.routingSource,
    level: o.request.level,
    priority: o.request.priority,
    reward: o.reward.toFixed(2),
    currency: o.request.currency,
    deadline: o.request.deadline,
    expiresAt: o.expiresAt,
  }));
});

verifierRoutes.get('/me/earnings', { summary: 'Wallet balances and ledger history', guard: requireVerifier() }, async (ctx) => {
  const { prisma } = deps();
  const wallet = await withTx((tx) => ensureWallet(tx, 'VERIFIER', ctx.auth.verifier!.id));
  const [transactions, payouts] = await Promise.all([
    prisma.walletTransaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.payout.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);
  const cfg = await getPlatformConfig();
  return {
    pending: wallet.pendingBalance.toFixed(2),
    available: wallet.availableBalance.toFixed(2),
    held: wallet.heldBalance.toFixed(2),
    currency: wallet.currency,
    minimumPayout: cfg.minimumPayout,
    transactions: transactions.map((t) => ({ id: t.id, direction: t.direction, bucket: t.bucket, category: t.category, amount: t.amount.toFixed(2), balanceAfter: t.balanceAfter.toFixed(2), description: t.description, requestId: t.requestId, createdAt: t.createdAt })),
    payouts: payouts.map((p) => ({ id: p.id, reference: p.reference, amount: p.amount.toFixed(2), status: p.status, bankName: p.bankName, accountLast4: p.accountLast4, createdAt: p.createdAt, failureReason: p.failureReason, rejectionReason: p.rejectionReason })),
  };
});

verifierRoutes.post('/me/payouts', { summary: 'Request a withdrawal (held until approved)', guard: requireVerifier({ approved: true }), body: payoutRequestSchema }, async (ctx) => {
  const { prisma, payouts: provider } = deps();
  const cfg = await getPlatformConfig();
  const amount = new Decimal(ctx.body.amount);
  if (amount.lt(cfg.minimumPayout)) throw badRequest(`Minimum payout is ${cfg.minimumPayout}`);
  const existing = await prisma.payout.findUnique({ where: { idempotencyKey: ctx.body.idempotencyKey } });
  if (existing) {
    if (existing.verifierId !== ctx.auth.verifier!.id) throw forbidden();
    return existing;
  }
  const v = await prisma.verifierProfile.findUniqueOrThrow({ where: { id: ctx.auth.verifier!.id } });
  if (!v.payoutRecipientCode || !v.payoutAccountLast4) throw badRequest('Add a payout bank account first');
  const payout = await withTx(async (tx) => {
    const wallet = await ensureWallet(tx, 'VERIFIER', v.id);
    const p = await tx.payout.create({
      data: {
        reference: reference('AVN-PO'),
        verifierId: v.id,
        walletId: wallet.id,
        amount: new Prisma.Decimal(amount.toFixed(2)),
        bankName: v.payoutBankName ?? '',
        accountLast4: v.payoutAccountLast4!,
        accountName: v.payoutAccountName ?? '',
        provider: provider.name,
        idempotencyKey: ctx.body.idempotencyKey,
      },
    });
    await moveBetweenBuckets(tx, wallet.id, 'AVAILABLE', 'HELD', amount.toFixed(2), 'PAYOUT_HOLD', `payout:${p.id}`, `Withdrawal ${p.reference} requested`, { payoutId: p.id });
    await audit(actorFrom(ctx), 'payout.requested', 'Payout', p.id, { amount: amount.toFixed(2) }, { db: tx });
    return p;
  });
  return payout;
});

verifierRoutes.get('/me/performance', { summary: 'Completion, timeliness, evidence quality and standing', guard: requireVerifier() }, async (ctx) => {
  const { prisma } = deps();
  const v = await prisma.verifierProfile.findUniqueOrThrow({ where: { id: ctx.auth.verifier!.id } });
  const [submitted, late, released, signals] = await Promise.all([
    prisma.verificationAssignment.count({ where: { verifierId: v.id, status: 'SUBMITTED' } }),
    prisma.verificationAssignment.count({ where: { verifierId: v.id, status: 'SUBMITTED', deadline: { not: null }, submittedAt: { not: null } } }).then(async () =>
      prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM "VerificationAssignment" WHERE "verifierId" = ${v.id}::uuid AND status = 'SUBMITTED' AND "submittedAt" > deadline`,
    ),
    prisma.verificationAssignment.count({ where: { verifierId: v.id, status: 'RELEASED' } }),
    prisma.fraudSignal.groupBy({ by: ['status'], where: { verifierId: v.id }, _count: true }),
  ]);
  const lateCount = late[0]?.n ?? 0;
  return {
    completedAssignments: submitted,
    onTimeRate: submitted ? Math.round(((submitted - lateCount) / submitted) * 100) : null,
    releasedAssignments: released,
    evidenceQuality: v.evidenceQualityAvg?.toFixed(1) ?? null,
    audit: { passed: v.auditPassCount, failed: v.auditFailCount, confirmedFraud: signals.find((s) => s.status === 'CONFIRMED_FRAUD')?._count ?? 0 },
    reliabilityScore: v.reliabilityScore.toFixed(1),
    reliabilityLevel: Number(v.reliabilityScore) >= 85 ? 'HIGH' : Number(v.reliabilityScore) >= 65 ? 'GOOD' : 'NEEDS_IMPROVEMENT',
    standing: v.status,
    note: 'Applicant absence never reduces your reliability score.',
  };
});

export const offerRoutes = routes('/offers', 'Assignments');
offerRoutes.post('/:id/accept', { summary: 'Accept a job offer (atomic, idempotent)', guard: requireVerifier({ approved: true }), body: z.object({ idempotencyKey: z.string().min(8).max(100) }) }, async (ctx) => {
  const { acceptOffer } = await import('../assignments/service');
  const a = await acceptOffer(z.string().uuid().parse(ctx.params.id), ctx.auth.verifier!.id, ctx.body.idempotencyKey, actorFrom(ctx));
  return { assignmentId: a.id };
});
offerRoutes.post('/:id/decline', { summary: 'Decline a job offer', guard: requireVerifier({ approved: true }), body: z.object({ reason: z.string().max(200).optional() }) }, async (ctx) => {
  const { declineOffer } = await import('../assignments/service');
  await declineOffer(z.string().uuid().parse(ctx.params.id), ctx.auth.verifier!.id, ctx.body.reason, actorFrom(ctx));
  return { ok: true };
});
