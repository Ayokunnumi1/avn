import { toMinorUnits } from '@avn/shared-utils/money';
import { deps } from '../../container';
import { audit, SYSTEM, type AuditActor } from '../../lib/audit';
import { conflict, notFound } from '../../lib/errors';
import { registerJob, enqueue } from '../../lib/jobs';
import { moveBetweenBuckets, postEntry } from '../../lib/ledger';
import { notifyUser } from '../../lib/notify';
import { withTx } from '../../lib/tx';

/** Finance approval (separate permission + password re-confirmation enforced at the route). */
export async function decidePayout(payoutId: string, decision: 'APPROVE' | 'REJECT', reason: string, adminUserId: string, actor: AuditActor) {
  const p = await withTx(async (tx) => {
    const payout = await tx.payout.findUnique({ where: { id: payoutId } });
    if (!payout) throw notFound('Payout');
    if (payout.status !== 'REQUESTED') throw conflict(`Payout is already ${payout.status}`);
    if (decision === 'REJECT') {
      await moveBetweenBuckets(tx, payout.walletId, 'HELD', 'AVAILABLE', payout.amount.toString(), 'PAYOUT_REVERSAL', `payout-reject:${payout.id}`, `Withdrawal ${payout.reference} rejected`, { payoutId: payout.id });
      await tx.payout.update({ where: { id: payout.id }, data: { status: 'REJECTED', rejectionReason: reason, approvedById: adminUserId, approvedAt: new Date() } });
    } else {
      await tx.payout.update({ where: { id: payout.id }, data: { status: 'APPROVED', approvedById: adminUserId, approvedAt: new Date() } });
    }
    await audit(actor, `payout.${decision.toLowerCase()}d`, 'Payout', payout.id, { reason, amount: payout.amount.toString() }, { db: tx });
    return payout;
  });
  if (decision === 'APPROVE') await enqueue('payouts.process', { payoutId });
  const v = await deps().prisma.verifierProfile.findUnique({ where: { id: p.verifierId }, select: { userId: true } });
  if (v) await notifyUser(v.userId, 'payout.update', { reference: p.reference, status: decision === 'APPROVE' ? 'approved' : 'rejected' }, { channels: ['PUSH'] });
}

/** Sends an approved payout to the provider. */
export async function processPayout(payoutId: string) {
  const { prisma, payouts } = deps();
  const p = await prisma.payout.findUnique({ where: { id: payoutId }, include: { verifier: true } });
  if (!p || p.status !== 'APPROVED') return;
  if (!p.verifier.payoutRecipientCode) {
    await settlePayout(p.reference, 'failed', 'No payout recipient on file');
    return;
  }
  await prisma.payout.update({ where: { id: p.id }, data: { status: 'PROCESSING' } });
  try {
    const t = await payouts.transfer({ amountMinor: toMinorUnits(p.amount.toString()), recipientCode: p.verifier.payoutRecipientCode, reference: p.reference, reason: `AVN earnings ${p.reference}` });
    await prisma.payout.update({ where: { id: p.id }, data: { providerReference: t.providerReference } });
    if (t.status !== 'pending') await settlePayout(p.reference, t.status);
  } catch (err) {
    await settlePayout(p.reference, 'failed', err instanceof Error ? err.message : 'Provider error');
  }
}

/** Final settlement (from the transfer response or the provider webhook). Idempotent. */
export async function settlePayout(ref: string, outcome: 'success' | 'failed', failureReason?: string) {
  await withTx(async (tx) => {
    const p = await tx.payout.findUnique({ where: { reference: ref } });
    if (!p || ['COMPLETED', 'FAILED', 'REJECTED'].includes(p.status)) return;
    if (outcome === 'success') {
      await postEntry(tx, { walletId: p.walletId, direction: 'DEBIT', bucket: 'HELD', category: 'PAYOUT_COMPLETE', amount: p.amount.toString(), reference: `payout-done:${p.id}`, description: `Withdrawal ${p.reference} paid`, payoutId: p.id });
      await tx.payout.update({ where: { id: p.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    } else {
      await moveBetweenBuckets(tx, p.walletId, 'HELD', 'AVAILABLE', p.amount.toString(), 'PAYOUT_REVERSAL', `payout-fail:${p.id}`, `Withdrawal ${p.reference} failed — funds returned`, { payoutId: p.id });
      await tx.payout.update({ where: { id: p.id }, data: { status: 'FAILED', failureReason: failureReason ?? 'Transfer failed' } });
    }
    await audit(SYSTEM('payouts'), `payout.${outcome === 'success' ? 'completed' : 'failed'}`, 'Payout', p.id, { failureReason }, { db: tx });
  });
}

registerJob<{ payoutId: string }>('payouts.process', async ({ payoutId }) => processPayout(payoutId));
