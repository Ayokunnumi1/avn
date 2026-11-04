import { deps } from '../../container';
import { audit, type AuditActor } from '../../lib/audit';
import { AppError, conflict, forbidden, notFound } from '../../lib/errors';
import { enqueue } from '../../lib/jobs';
import { getPlatformConfig } from '../../lib/settings';
import { withTx } from '../../lib/tx';
import { transition } from '../requests/transitions';

const ACTIVE = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] as const;

/**
 * Atomic acceptance (spec B6/§5.6). Three independent guards make double-award impossible:
 *  1. conditional status update on the request (only one transaction can move it out of DISPATCHING/ASSIGNED),
 *  2. a partial unique index allowing one live assignment per request,
 *  3. an idempotency key so client retries return the original result.
 */
export async function acceptOffer(invitationId: string, verifierId: string, idempotencyKey: string, actor: AuditActor) {
  const { prisma } = deps();
  const replay = await prisma.verificationAssignment.findUnique({ where: { idempotencyKey } });
  if (replay) {
    if (replay.verifierId !== verifierId) throw conflict('Idempotency key already used');
    return replay;
  }
  const verifier = await prisma.verifierProfile.findUnique({ where: { id: verifierId } });
  if (!verifier || verifier.status !== 'APPROVED') throw forbidden('Only approved verifiers can accept assignments');

  try {
    return await withTx(async (tx, after) => {
      const inv = await tx.assignmentInvitation.findUnique({ where: { id: invitationId } });
      if (!inv || inv.verifierId !== verifierId) throw notFound('Offer');
      if (inv.status !== 'SENT') throw new AppError(409, 'OFFER_UNAVAILABLE', 'This offer is no longer available');
      if (inv.expiresAt < new Date()) throw new AppError(409, 'OFFER_EXPIRED', 'This offer has expired');
      const busy = await tx.verificationAssignment.count({ where: { verifierId, status: { in: [...ACTIVE] } } });
      if (busy > 0) throw conflict('Finish your current assignment before accepting another');

      const req = await tx.verificationRequest.findUniqueOrThrow({ where: { id: inv.requestId } });
      // Guard 1 — exactly one caller can win this conditional update.
      await transition(tx, after, inv.requestId, 'ACCEPTED', { type: 'VERIFIER', id: verifierId }, { expectFrom: ['DISPATCHING', 'ASSIGNED'], note: 'Verifier accepted the assignment' });

      const cfg = await getPlatformConfig();
      // Guard 2 — partial unique index "VerificationAssignment_one_active_per_request".
      const assignment = await tx.verificationAssignment.create({
        data: {
          requestId: inv.requestId,
          verifierId,
          invitationId: inv.id,
          idempotencyKey,
          reward: inv.reward,
          distanceM: inv.distanceM,
          walkingMinutes: inv.walkingMinutes,
          routingSource: inv.routingSource,
          deadline: req.deadline ?? new Date(Date.now() + cfg.assignmentOfferSeconds * 1000 * 24),
        },
      });
      await tx.fieldVisit.create({ data: { assignmentId: assignment.id, requestId: inv.requestId, verifierId } });
      await tx.assignmentInvitation.update({ where: { id: inv.id }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
      await tx.assignmentInvitation.updateMany({ where: { requestId: inv.requestId, status: 'SENT', id: { not: inv.id } }, data: { status: 'WITHDRAWN' } });
      await audit(actor, 'assignment.accepted', 'VerificationAssignment', assignment.id, { requestId: inv.requestId, invitationId }, { organisationId: req.organisationId, db: tx });
      return assignment;
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'P2002' || code === 'P2034') throw new AppError(409, 'ALREADY_ASSIGNED', 'This job has already been taken by another verifier');
    throw err;
  }
}

export async function declineOffer(invitationId: string, verifierId: string, reason: string | undefined, actor: AuditActor) {
  const { prisma } = deps();
  const inv = await prisma.assignmentInvitation.findUnique({ where: { id: invitationId } });
  if (!inv || inv.verifierId !== verifierId) throw notFound('Offer');
  if (inv.status !== 'SENT') return inv;
  const updated = await prisma.assignmentInvitation.update({ where: { id: inv.id }, data: { status: 'DECLINED', respondedAt: new Date(), declineReason: reason } });
  await audit(actor, 'assignment.declined', 'AssignmentInvitation', inv.id, { reason });
  const remaining = await prisma.assignmentInvitation.count({ where: { requestId: inv.requestId, status: 'SENT', expiresAt: { gt: new Date() } } });
  const r = await prisma.verificationRequest.findUnique({ where: { id: inv.requestId }, select: { status: true } });
  if (remaining === 0 && r?.status === 'ASSIGNED') {
    await withTx((tx, after) => transition(tx, after, inv.requestId, 'READY_FOR_ASSIGNMENT', { type: 'VERIFIER', id: verifierId }, { note: 'Assigned verifier declined' }));
  } else if (remaining === 0) await enqueue('dispatch.run', { requestId: inv.requestId });
  return updated;
}

/** Verifier or admin releases an accepted job back to the pool (reassignment). */
export async function releaseAssignment(assignmentId: string, reason: string, actor: AuditActor, actorType: 'VERIFIER' | 'ADMIN') {
  return withTx(async (tx, after) => {
    const a = await tx.verificationAssignment.findUnique({ where: { id: assignmentId } });
    if (!a) throw notFound('Assignment');
    if (!(ACTIVE as readonly string[]).includes(a.status)) throw conflict('Assignment is not active');
    await tx.verificationAssignment.update({ where: { id: a.id }, data: { status: 'RELEASED', releasedAt: new Date(), releaseReason: reason } });
    await tx.verificationRequest.update({ where: { id: a.requestId }, data: { dispatchTier: 0 } });
    await transition(tx, after, a.requestId, 'READY_FOR_ASSIGNMENT', { type: actorType, id: actor.auth?.user?.id }, { note: `Released: ${reason}` });
    await audit(actor, 'assignment.released', 'VerificationAssignment', a.id, { reason }, { db: tx });
  });
}
