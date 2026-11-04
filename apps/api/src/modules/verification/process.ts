import { checklistSchema, policyRulesSchema, statusForOutcome, type FinalOutcome, type FindingKey, type FindingValue } from '@avn/contracts';
import { Prisma, type Tx } from '@avn/database';
import { deps } from '../../container';
import { audit, SYSTEM, type AuditActor } from '../../lib/audit';
import { conflict } from '../../lib/errors';
import { enqueue } from '../../lib/jobs';
import { ensureWallet, moveBetweenBuckets, postEntry } from '../../lib/ledger';
import { notifyUser } from '../../lib/notify';
import { getPlatformConfig } from '../../lib/settings';
import { withTx, type After } from '../../lib/tx';
import { aggregate } from '../fraud/rules';
import { transition } from '../requests/transitions';
import { evaluate, type EngineResult } from './engine';

/** Runs the deterministic engine on a submitted visit and applies the outcome. */
export async function processVerification(requestId: string): Promise<EngineResult | null> {
  const { prisma } = deps();
  const r = await prisma.verificationRequest.findUnique({
    where: { id: requestId },
    include: { fieldVisits: { where: { submittedAt: { not: null } }, orderBy: { submittedAt: 'desc' }, take: 1 }, documents: true },
  });
  if (!r || r.status !== 'PROCESSING') return null;
  const visit = r.fieldVisits[0];
  if (!visit) return null;
  const cfg = await getPlatformConfig();
  const [evidence, signals] = await Promise.all([
    prisma.verificationEvidence.findMany({ where: { visitId: visit.id }, select: { category: true, duplicateOfId: true } }),
    prisma.fraudSignal.findMany({ where: { requestId, status: { not: 'FALSE_POSITIVE' } } }),
  ]);
  const policy = policyRulesSchema.parse((r.policySnapshot as { rules?: unknown }).rules ?? {});
  const fraud = aggregate(signals);
  const result = evaluate({
    checklist: checklistSchema.parse(visit.checklist),
    policy,
    arrival: {
      distanceM: visit.distanceFromTargetM,
      thresholdM: visit.thresholdM ?? cfg.arrivalThresholdM,
      withinThreshold: visit.withinThreshold,
      accuracyM: visit.arrivalAccuracyM,
      exception: (visit.arrivalException ?? 'NONE') as 'NONE',
    },
    evidence: { categoriesPresent: [...new Set(evidence.map((e) => e.category))], count: evidence.length, duplicates: evidence.filter((e) => e.duplicateOfId).length },
    applicantCodeConfirmed: !!visit.applicantConfirmedAt,
    supportingDocuments: r.documents.length,
    fraud,
  });

  await withTx(async (tx, after) => {
    await writeFindings(tx, requestId, result.findings.map((f) => ({ key: f.key, value: f.value, basis: f.basis })), 'ENGINE', result.rulesVersion);
    await tx.verificationRequest.update({ where: { id: requestId }, data: { riskScore: fraud.score, riskFlagged: fraud.highSeverity || fraud.score >= policy.manualReviewRiskThreshold } });
    if (result.outcome === 'MANUAL_REVIEW') {
      await transition(tx, after, requestId, 'MANUAL_REVIEW', { type: 'SYSTEM' }, { note: result.reasons.join('; ').slice(0, 480) });
      await tx.manualReview.create({ data: { requestId, trigger: fraud.highSeverity ? 'FRAUD' : 'ENGINE', reasons: result.reasons } });
      after(async () => {
        const reviewers = await deps().prisma.user.findMany({ where: { accountType: 'ADMIN', adminRole: { in: ['SUPER_ADMIN', 'REVIEWER'] }, status: 'ACTIVE' }, select: { id: true } });
        for (const u of reviewers) await notifyUser(u.id, 'review.required', { reference: r.reference }, { channels: [] });
      });
    } else {
      await applyFinalOutcome(tx, after, requestId, result.outcome, { type: 'SYSTEM' }, result.reasons.join('; '));
      await creditEarning(tx, requestId);
    }
    await audit(SYSTEM('verification-engine'), 'verification.evaluated', 'VerificationRequest', requestId, { outcome: result.outcome, rulesVersion: result.rulesVersion, riskScore: fraud.score }, { organisationId: r.organisationId, db: tx });
  });
  await updateVerifierStats(visit.verifierId);
  return result;
}

export async function writeFindings(tx: Tx, requestId: string, findings: Array<{ key: FindingKey; value: FindingValue; basis: string[] }>, source: 'ENGINE' | 'REVIEWER', rulesVersion: string, createdById?: string) {
  const keys = findings.map((f) => f.key);
  await tx.verificationFinding.updateMany({ where: { requestId, key: { in: keys }, supersededAt: null }, data: { supersededAt: new Date() } });
  await tx.verificationFinding.createMany({ data: findings.map((f) => ({ requestId, key: f.key, value: f.value, basis: f.basis, source, rulesVersion, createdById })) });
}

export async function applyFinalOutcome(tx: Tx, after: After, requestId: string, outcome: Exclude<FinalOutcome, 'MANUAL_REVIEW'>, actor: { type: 'SYSTEM' | 'ADMIN'; id?: string }, note: string) {
  await transition(tx, after, requestId, statusForOutcome(outcome), actor, { note: note.slice(0, 480), data: { outcome, outcomeAt: new Date() } });
  after(() => enqueue('reports.generate', { requestId }));
}

/** Verifier earns the reward for a completed visit — including when the applicant was absent. */
export async function creditEarning(tx: Tx, requestId: string) {
  const a = await tx.verificationAssignment.findFirst({ where: { requestId, status: 'SUBMITTED' }, orderBy: { submittedAt: 'desc' } });
  if (!a) return;
  const cfg = await getPlatformConfig();
  const wallet = await ensureWallet(tx, 'VERIFIER', a.verifierId);
  const ref = `earning:${a.id}`;
  await postEntry(tx, { walletId: wallet.id, direction: 'CREDIT', bucket: 'PENDING', category: 'VERIFICATION_EARNING', amount: a.reward.toString(), reference: ref, description: 'Verification visit reward', requestId });
  if (cfg.earningsHoldHours === 0) {
    await moveBetweenBuckets(tx, wallet.id, 'PENDING', 'AVAILABLE', a.reward.toString(), 'EARNING_RELEASE', `release:${a.id}`, 'Earnings approved', { requestId });
  }
}

/** Reviewer resolution of a manual review (spec D6). */
export async function resolveReview(
  reviewId: string,
  input: { outcome: Exclude<FinalOutcome, 'MANUAL_REVIEW'>; note: string; findingOverrides: Array<{ key: FindingKey; value: FindingValue; note: string }>; requestRevisit: boolean },
  adminUserId: string,
  actor: AuditActor,
) {
  return withTx(async (tx, after) => {
    const review = await tx.manualReview.findUniqueOrThrow({ where: { id: reviewId }, include: { request: true } });
    if (review.status === 'RESOLVED') throw conflict('Review already resolved');
    if (review.request.status !== 'MANUAL_REVIEW') throw conflict(`Request is ${review.request.status}`);
    if (input.findingOverrides.length) {
      await writeFindings(tx, review.requestId, input.findingOverrides.map((o) => ({ key: o.key, value: o.value, basis: [`Reviewer override: ${o.note}`] })), 'REVIEWER', 'manual-review', adminUserId);
    }
    const notes = [...((review.notes as unknown[]) ?? []), { by: adminUserId, note: input.note, at: new Date().toISOString(), kind: 'RESOLUTION' }];
    if (input.requestRevisit) {
      await tx.verificationRequest.update({ where: { id: review.requestId }, data: { dispatchTier: 0 } });
      await transition(tx, after, review.requestId, 'READY_FOR_ASSIGNMENT', { type: 'ADMIN', id: adminUserId }, { note: `Re-visit requested: ${input.note}` });
    } else {
      await applyFinalOutcome(tx, after, review.requestId, input.outcome, { type: 'ADMIN', id: adminUserId }, `Manual review: ${input.note}`);
    }
    const confirmedFraud = await tx.fraudSignal.count({ where: { requestId: review.requestId, status: 'CONFIRMED_FRAUD' } });
    if (!confirmedFraud) await creditEarning(tx, review.requestId);
    await tx.manualReview.update({ where: { id: reviewId }, data: { status: 'RESOLVED', outcome: input.requestRevisit ? null : input.outcome, resolvedById: adminUserId, resolvedAt: new Date(), notes: notes as object } });
    await audit(actor, 'review.resolved', 'ManualReview', reviewId, { outcome: input.outcome, revisit: input.requestRevisit, overrides: input.findingOverrides.length }, { organisationId: review.request.organisationId, db: tx });
  });
}

/** Reliability score: completion and timeliness count; applicant absence never penalises. */
export async function updateVerifierStats(verifierId: string) {
  const { prisma } = deps();
  const [completed, late, released, fraud] = await Promise.all([
    prisma.verificationAssignment.count({ where: { verifierId, status: 'SUBMITTED' } }),
    prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM "VerificationAssignment" WHERE "verifierId" = ${verifierId}::uuid AND status = 'SUBMITTED' AND "submittedAt" > deadline`,
    prisma.verificationAssignment.count({ where: { verifierId, status: 'RELEASED' } }),
    prisma.fraudSignal.count({ where: { verifierId, status: 'CONFIRMED_FRAUD' } }),
  ]);
  const lateN = late[0]?.n ?? 0;
  const score = Math.max(0, Math.min(100, 80 + Math.min(completed, 40) * 0.5 - lateN * 3 - released * 2 - fraud * 25));
  await prisma.verifierProfile.update({ where: { id: verifierId }, data: { completedCount: completed, onTimeCount: completed - lateN, reliabilityScore: new Prisma.Decimal(score.toFixed(2)) } });
}
