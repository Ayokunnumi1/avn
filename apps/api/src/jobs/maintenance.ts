import { deps } from '../container';
import { audit, SYSTEM } from '../lib/audit';
import { enqueue, registerJob } from '../lib/jobs';
import { moveBetweenBuckets } from '../lib/ledger';
import { getPlatformConfig } from '../lib/settings';
import { withTx } from '../lib/tx';
import { deliver } from '../lib/notify';
import { deliverWebhook } from '../modules/integrations/webhooks';
import { dispatchRequest } from '../modules/assignments/dispatch';
import { transition } from '../modules/requests/transitions';
import { processVerification } from '../modules/verification/process';
import { generateReport } from '../modules/reports/service';
import { processBulk } from '../modules/organisations/requests';
import { reconcilePayments } from '../modules/payments/service';

/**
 * Periodic maintenance (every 30 s in the worker). Also the recovery path when Redis was
 * unavailable: all work is re-derived from database state, so nothing is lost.
 */
export async function maintenanceTick(only?: string): Promise<Record<string, number>> {
  const { prisma, log } = deps();
  const cfg = await getPlatformConfig();
  const now = new Date();
  const stats: Record<string, number> = {};

  // 1. Expire stale heartbeats → verifier becomes unavailable automatically.
  const staleBefore = new Date(now.getTime() - cfg.heartbeatExpirySeconds * 1000);
  const expired = await prisma.verifierAvailability.updateMany({ where: { isAvailable: true, lastHeartbeatAt: { lt: staleBefore } }, data: { isAvailable: false, sessionId: null, endedReason: 'HEARTBEAT_EXPIRED' } });
  stats.heartbeatsExpired = expired.count;
  if (expired.count) await prisma.assignmentInvitation.updateMany({ where: { status: 'SENT', verifier: { availability: { isAvailable: false } } }, data: { status: 'WITHDRAWN' } });

  // 2. Expire unanswered offers and redispatch requests with no live offers.
  stats.offersExpired = (await prisma.assignmentInvitation.updateMany({ where: { status: 'SENT', expiresAt: { lt: now } }, data: { status: 'EXPIRED' } })).count;
  const waiting = await prisma.verificationRequest.findMany({
    where: {
      OR: [
        { status: 'DISPATCHING', offers: { none: { status: 'SENT' } } },
        { status: 'READY_FOR_ASSIGNMENT', OR: [{ lastDispatchAt: null }, { lastDispatchAt: { lt: new Date(now.getTime() - (only === 'redispatch' ? 0 : 5 * 60_000)) } }] },
        { status: 'ASSIGNED', offers: { none: { status: 'SENT' } } },
      ],
    },
    select: { id: true, status: true, dispatchTier: true, coverageFallback: true },
    take: 100,
  });
  for (const r of waiting) {
    if (r.status === 'ASSIGNED') {
      await withTx((tx, after) => transition(tx, after, r.id, 'READY_FOR_ASSIGNMENT', { type: 'SYSTEM' }, { note: 'Manual assignment not accepted in time' })).catch(() => undefined);
      continue;
    }
    if (r.status === 'DISPATCHING') await prisma.verificationRequest.update({ where: { id: r.id }, data: { dispatchTier: Math.min(r.dispatchTier + 1, cfg.walkingTiersMinutes.length - 1) } });
    if (r.coverageFallback) await prisma.verificationRequest.update({ where: { id: r.id }, data: { dispatchTier: 0 } });
    await dispatchRequest(r.id).catch((err) => log.error({ err, requestId: r.id }, 'Redispatch failed'));
  }
  stats.redispatched = waiting.length;
  if (only === 'redispatch') return stats;

  // 3. Expire institution invitations past their deadline.
  const lapsed = await prisma.applicantInvitation.findMany({ where: { status: { in: ['PENDING', 'OPENED'] }, expiresAt: { lt: now } }, select: { id: true, requestId: true } });
  for (const inv of lapsed) {
    await withTx(async (tx, after) => {
      await tx.applicantInvitation.update({ where: { id: inv.id }, data: { status: 'EXPIRED' } });
      const r = await tx.verificationRequest.findUnique({ where: { id: inv.requestId } });
      if (r?.status === 'AWAITING_APPLICANT') await transition(tx, after, r.id, 'EXPIRED', { type: 'SYSTEM' }, { note: 'Applicant did not respond before the invitation expired' });
    }).catch(() => undefined);
  }
  stats.invitationsExpired = lapsed.length;

  // 4. Release held earnings after the approval window.
  if (cfg.earningsHoldHours > 0) {
    const due = await prisma.walletTransaction.findMany({ where: { category: 'VERIFICATION_EARNING', bucket: 'PENDING', direction: 'CREDIT', createdAt: { lt: new Date(now.getTime() - cfg.earningsHoldHours * 3600_000) } }, take: 200 });
    for (const t of due) {
      const ref = t.reference.replace('earning:', 'release:');
      const done = await prisma.walletTransaction.findFirst({ where: { walletId: t.walletId, reference: ref } });
      if (!done) await withTx((tx) => moveBetweenBuckets(tx, t.walletId, 'PENDING', 'AVAILABLE', t.amount.toString(), 'EARNING_RELEASE', ref, 'Earnings approved', { requestId: t.requestId ?? undefined }));
    }
    stats.earningsReleased = due.length;
  }

  // 5. Outbox sweeps: deliveries, webhooks, stuck processing, missing reports, bulk jobs.
  const deliveries = await prisma.notificationDelivery.findMany({ where: { status: 'QUEUED', updatedAt: { lt: new Date(now.getTime() - 60_000) } }, take: 100, select: { id: true } });
  for (const d of deliveries) await deliver(d.id).catch(() => undefined);
  const hooks = await prisma.webhookDelivery.findMany({ where: { status: 'QUEUED', nextAttemptAt: { lte: now } }, take: 100, select: { id: true } });
  for (const h of hooks) await deliverWebhook(h.id).catch(() => undefined);
  const stuck = await prisma.verificationRequest.findMany({ where: { status: 'PROCESSING', updatedAt: { lt: new Date(now.getTime() - 60_000) } }, select: { id: true }, take: 50 });
  for (const s of stuck) await processVerification(s.id).catch((err) => log.error({ err }, 'Reprocess failed'));
  const noReport = await prisma.verificationRequest.findMany({ where: { outcome: { in: ['VERIFIED', 'PARTIALLY_VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE'] }, status: { in: ['COMPLETED', 'PARTIALLY_VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE'] }, reports: { none: {} }, outcomeAt: { lt: new Date(now.getTime() - 60_000) } }, select: { id: true }, take: 20 });
  for (const r of noReport) await generateReport(r.id).catch((err) => log.error({ err }, 'Report generation failed'));
  const bulk = await prisma.bulkUpload.findMany({ where: { status: 'PROCESSING', createdAt: { lt: new Date(now.getTime() - 2 * 60_000) } }, take: 5 });
  for (const b of bulk) await processBulk(b.id, b.uploadedById).catch(() => undefined);
  Object.assign(stats, { deliveriesRetried: deliveries.length, webhooksRetried: hooks.length, reprocessed: stuck.length, reportsGenerated: noReport.length });

  // 6. Data minimisation: purge location history beyond the retention window.
  stats.locationsPurged = (await prisma.verifierLocation.deleteMany({ where: { receivedAt: { lt: new Date(now.getTime() - cfg.locationRetentionDays * 86400_000) } } })).count;

  // 7. Hourly-ish reconciliation of stale payments.
  if (now.getMinutes() % 15 === 0 && now.getSeconds() < 30) await reconcilePayments(15).catch(() => undefined);

  if (Object.values(stats).some((v) => v > 0)) await audit(SYSTEM('maintenance'), 'maintenance.tick', 'System', null, stats).catch(() => undefined);
  return stats;
}

registerJob<{ only?: string }>('maintenance.tick', async ({ only }) => {
  await maintenanceTick(only);
});

export async function scheduleRedispatch() {
  await enqueue('maintenance.tick', { only: 'redispatch' });
}
