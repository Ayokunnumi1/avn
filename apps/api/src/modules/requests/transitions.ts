import { assertTransition, FINAL_REQUEST_STATUSES, type RequestStatus } from '@avn/contracts';
import type { Prisma, Tx } from '@avn/database';
import { deps } from '../../container';
import { conflict, notFound } from '../../lib/errors';
import { enqueue } from '../../lib/jobs';
import { notifyUser } from '../../lib/notify';
import type { After } from '../../lib/tx';
import { emitWebhook } from '../integrations/webhooks';

export interface TransitionActor {
  type: 'SYSTEM' | 'APPLICANT' | 'VERIFIER' | 'INSTITUTION' | 'ADMIN' | 'API';
  id?: string | null;
}

/**
 * The only way a verification request changes status. Validates the transition against
 * the state machine, applies it with optimistic concurrency (the row must still be in
 * the expected status) and records the timeline event. Side effects run after commit.
 */
export async function transition(
  tx: Tx,
  after: After,
  requestId: string,
  to: RequestStatus,
  actor: TransitionActor,
  opts: { note?: string; data?: Prisma.VerificationRequestUncheckedUpdateManyInput; expectFrom?: RequestStatus[] } = {},
): Promise<RequestStatus> {
  const r = await tx.verificationRequest.findUnique({ where: { id: requestId }, select: { status: true } });
  if (!r) throw notFound('Verification request');
  if (opts.expectFrom && !opts.expectFrom.includes(r.status)) throw conflict(`Request is ${r.status}, expected ${opts.expectFrom.join(' or ')}`);
  assertTransition(r.status, to);
  const { count } = await tx.verificationRequest.updateMany({ where: { id: requestId, status: r.status }, data: { ...opts.data, status: to } });
  if (count !== 1) throw conflict('The request was updated by someone else. Refresh and try again.');
  await tx.requestStatusEvent.create({
    data: { requestId, fromStatus: r.status, toStatus: to, actorType: actor.type, actorId: actor.id ?? null, note: opts.note?.slice(0, 500) },
  });
  const from = r.status;
  after(() => onStatusChanged(requestId, from, to));
  return from;
}

const APPLICANT_NOTIFY: Partial<Record<RequestStatus, string>> = {
  ACCEPTED: 'request.status',
  ARRIVED: 'request.status',
  COMPLETED: 'request.completed',
  PARTIALLY_VERIFIED: 'request.completed',
  NOT_VERIFIED: 'request.completed',
  INCONCLUSIVE: 'request.completed',
  CANCELLED: 'request.status',
};

export async function onStatusChanged(requestId: string, from: RequestStatus, to: RequestStatus): Promise<void> {
  const { prisma } = deps();
  const r = await prisma.verificationRequest.findUnique({
    where: { id: requestId },
    select: { id: true, reference: true, organisationId: true, customerReference: true, applicantUserId: true, outcome: true, updatedAt: true, status: true },
  });
  if (!r) return;
  if (to === 'READY_FOR_ASSIGNMENT') await enqueue('dispatch.run', { requestId });
  if (r.organisationId) {
    const payload = { id: r.id, reference: r.reference, customerReference: r.customerReference, previousStatus: from, status: to, outcome: r.outcome, occurredAt: new Date().toISOString() };
    await emitWebhook(r.organisationId, 'verification.status_changed', payload);
    if ((FINAL_REQUEST_STATUSES as readonly string[]).includes(to) && to !== 'CANCELLED' && to !== 'EXPIRED') {
      await emitWebhook(r.organisationId, 'verification.completed', payload);
    }
  }
  const key = APPLICANT_NOTIFY[to];
  if (key && r.applicantUserId) {
    await notifyUser(r.applicantUserId, key, { reference: r.reference }, { channels: ['PUSH', 'SMS'], data: { requestId: r.id } });
  }
}
