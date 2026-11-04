import { Prisma } from '@avn/database';
import { formatMoney } from '@avn/shared-utils/money';
import { deps } from '../../container';
import { audit, SYSTEM } from '../../lib/audit';
import { enqueue, registerJob } from '../../lib/jobs';
import { notifyUser } from '../../lib/notify';
import { getPlatformConfig } from '../../lib/settings';
import { withTx } from '../../lib/tx';
import { transition } from '../requests/transitions';
import { exclusionReason, nextTier, rank, searchRadiusMetres, type Candidate } from './engine';

interface CandidateRow {
  verifierId: string;
  userId: string;
  phone: string | null;
  status: string;
  isAvailable: boolean;
  lastHeartbeatAt: Date | null;
  lastLat: number | null;
  lastLng: number | null;
  homeLat: number | null;
  homeLng: number | null;
  reliability: number;
  active: number;
  invited: boolean;
}

/** PostGIS spatial pre-filter: available, approved verifiers with a fresh heartbeat inside the radius. */
export async function findSpatialCandidates(requestId: string, lat: number, lng: number, radiusM: number, expirySec: number): Promise<Candidate[]> {
  const rows = await deps().prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
    SELECT vp.id AS "verifierId", u.id AS "userId", u.phone, vp.status::text AS status, va."isAvailable", va."lastHeartbeatAt",
           va."lastLat", va."lastLng", vp."homeLat", vp."homeLng", vp."reliabilityScore"::float AS reliability,
           (SELECT count(*) FROM "VerificationAssignment" x WHERE x."verifierId" = vp.id AND x.status IN ('ACCEPTED','EN_ROUTE','ARRIVED','IN_PROGRESS'))::int AS active,
           EXISTS (SELECT 1 FROM "AssignmentInvitation" ai WHERE ai."requestId" = ${requestId}::uuid AND ai."verifierId" = vp.id) AS invited
    FROM "VerifierAvailability" va
    JOIN "VerifierProfile" vp ON vp.id = va."verifierId"
    JOIN "User" u ON u.id = vp."userId"
    WHERE va."isAvailable" = true
      AND vp.status = 'APPROVED'
      AND u.status = 'ACTIVE'
      AND va."lastHeartbeatAt" > now() - make_interval(secs => ${expirySec})
      AND va.location IS NOT NULL
      AND ST_DWithin(va.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radiusM})
    ORDER BY ST_Distance(va.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography)
    LIMIT 50`);
  return rows.map((r) => ({
    verifierId: r.verifierId,
    userId: r.userId,
    phone: r.phone,
    status: r.status,
    isAvailable: r.isAvailable,
    lastHeartbeatAt: r.lastHeartbeatAt,
    position: r.lastLat != null && r.lastLng != null ? { lat: r.lastLat, lng: r.lastLng } : null,
    home: r.homeLat != null && r.homeLng != null ? { lat: r.homeLat, lng: r.homeLng } : null,
    reliabilityScore: r.reliability,
    activeAssignments: r.active,
    alreadyInvited: r.invited,
  }));
}

export interface DispatchOutcome {
  invited: number;
  tierMinutes: number | null;
  exhausted: boolean;
}

/**
 * One dispatch round (spec §5.3/§5.5): find eligible verifiers within the current walking
 * tier using real pedestrian routing, invite the best N, or expand the tier.
 */
export async function dispatchRequest(requestId: string, depth = 0): Promise<DispatchOutcome> {
  const { prisma, router, log, jobsMode } = deps();
  const cfg = await getPlatformConfig();
  const r = await prisma.verificationRequest.findUnique({ where: { id: requestId }, include: { address: true } });
  if (!r || !r.address || !['READY_FOR_ASSIGNMENT', 'DISPATCHING'].includes(r.status)) return { invited: 0, tierMinutes: null, exhausted: false };
  const live = await prisma.assignmentInvitation.count({ where: { requestId, status: 'SENT', expiresAt: { gt: new Date() } } });
  if (live > 0) return { invited: 0, tierMinutes: cfg.walkingTiersMinutes[r.dispatchTier] ?? null, exhausted: false };

  const tierIdx = Math.min(r.dispatchTier, cfg.walkingTiersMinutes.length - 1);
  const minutes = cfg.walkingTiersMinutes[tierIdx]!;
  const target = { lat: r.address.lat, lng: r.address.lng };
  const ctx = {
    target,
    maxWalkingMinutes: minutes,
    heartbeatExpirySeconds: cfg.heartbeatExpirySeconds,
    now: new Date(),
    applicantPhone: r.applicantPhone,
    applicantUserId: r.applicantUserId,
    limit: cfg.invitationsPerTier,
  };
  const spatial = await findSpatialCandidates(requestId, target.lat, target.lng, searchRadiusMetres(minutes), cfg.heartbeatExpirySeconds);
  const eligible = spatial.filter((c) => exclusionReason(c, ctx) === null);
  const routes = await router.walkingMatrix(
    eligible.map((c) => c.position!),
    target,
  );
  const ranked = rank(eligible, routes, ctx);

  if (ranked.length > 0) {
    const expiresAt = new Date(Date.now() + cfg.assignmentOfferSeconds * 1000);
    await withTx(async (tx, after) => {
      if (r.status === 'READY_FOR_ASSIGNMENT') {
        await transition(tx, after, requestId, 'DISPATCHING', { type: 'SYSTEM' }, { note: `Inviting ${ranked.length} verifier(s) within ${minutes} min walk`, data: { dispatchStartedAt: r.dispatchStartedAt ?? new Date() } });
      }
      await tx.verificationRequest.update({ where: { id: requestId }, data: { dispatchTier: tierIdx, lastDispatchAt: new Date(), coverageFallback: null } });
      for (const { candidate, route } of ranked) {
        await tx.assignmentInvitation.create({
          data: {
            requestId,
            verifierId: candidate.verifierId,
            tier: tierIdx,
            distanceM: route.distanceM,
            walkingMinutes: new Prisma.Decimal(route.durationMin),
            routingSource: route.source,
            reward: r.verifierReward,
            expiresAt,
          },
        });
        after(() =>
          notifyUser(candidate.userId, 'verifier.job_offer', { minutes: Math.round(route.durationMin), reward: formatMoney(r.verifierReward.toString(), r.currency) }, { channels: ['PUSH'], data: { requestId } }),
        );
      }
      await audit(SYSTEM('dispatcher'), 'dispatch.invited', 'VerificationRequest', requestId, { tierMinutes: minutes, invited: ranked.map((x) => ({ v: x.candidate.verifierId, min: x.route.durationMin, src: x.route.source })) }, { organisationId: r.organisationId, db: tx });
    });
    return { invited: ranked.length, tierMinutes: minutes, exhausted: false };
  }

  const next = nextTier(cfg.walkingTiersMinutes, tierIdx);
  if (next !== null) {
    await prisma.verificationRequest.update({ where: { id: requestId }, data: { dispatchTier: next, lastDispatchAt: new Date() } });
    log.info({ requestId, from: minutes, to: cfg.walkingTiersMinutes[next] }, 'No eligible verifiers — expanding walking-time search');
    if (jobsMode === 'inline' && depth < 10) return dispatchRequest(requestId, depth + 1);
    await enqueue('dispatch.run', { requestId }, { delayMs: 30_000 });
    return { invited: 0, tierMinutes: cfg.walkingTiersMinutes[next]!, exhausted: false };
  }

  // Coverage unavailable: keep the request open for delayed assignment and surface the fallbacks.
  await prisma.verificationRequest.update({ where: { id: requestId }, data: { coverageFallback: cfg.unavailabilityFallbacks.join(','), lastDispatchAt: new Date(), dispatchTier: 0 } });
  await audit(SYSTEM('dispatcher'), 'dispatch.no_coverage', 'VerificationRequest', requestId, { fallbacks: cfg.unavailabilityFallbacks }, { organisationId: r.organisationId });
  return { invited: 0, tierMinutes: null, exhausted: true };
}

registerJob<{ requestId: string }>('dispatch.run', async ({ requestId }) => {
  await dispatchRequest(requestId);
});
