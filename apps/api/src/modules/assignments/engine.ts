import { haversineMetres, WALKING_SPEED_M_PER_MIN, type LatLng } from '@avn/shared-utils/geo';
import type { WalkingRoute } from '@avn/maps';

/**
 * Pure, deterministic candidate selection for the assignment engine (spec §5.3).
 * I/O (PostGIS query, routing engine) happens in the dispatcher; this module decides.
 */
export interface Candidate {
  verifierId: string;
  userId: string;
  phone: string | null;
  status: string;
  isAvailable: boolean;
  lastHeartbeatAt: Date | null;
  position: LatLng | null;
  home: LatLng | null;
  reliabilityScore: number;
  activeAssignments: number;
  alreadyInvited: boolean;
}

export interface SelectionContext {
  target: LatLng;
  maxWalkingMinutes: number;
  heartbeatExpirySeconds: number;
  now: Date;
  applicantPhone: string;
  applicantUserId: string | null;
  limit: number;
}

export type Exclusion = 'NOT_APPROVED' | 'UNAVAILABLE' | 'STALE_LOCATION' | 'BUSY' | 'CONFLICT_OF_INTEREST' | 'ALREADY_INVITED' | 'TOO_FAR';
export interface Ranked {
  candidate: Candidate;
  route: WalkingRoute;
}

/** Straight-line radius that can possibly be walked within `minutes` (used for the PostGIS pre-filter). */
export const searchRadiusMetres = (minutes: number) => Math.ceil(minutes * WALKING_SPEED_M_PER_MIN * 1.1);

export function exclusionReason(c: Candidate, ctx: SelectionContext): Exclusion | null {
  if (c.status !== 'APPROVED') return 'NOT_APPROVED';
  if (!c.isAvailable) return 'UNAVAILABLE';
  if (!c.lastHeartbeatAt || !c.position || ctx.now.getTime() - c.lastHeartbeatAt.getTime() > ctx.heartbeatExpirySeconds * 1000) return 'STALE_LOCATION';
  if (c.activeAssignments > 0) return 'BUSY';
  if (c.userId === ctx.applicantUserId) return 'CONFLICT_OF_INTEREST';
  if (c.phone && c.phone === ctx.applicantPhone) return 'CONFLICT_OF_INTEREST';
  if (c.home && haversineMetres(c.home, ctx.target) < 150) return 'CONFLICT_OF_INTEREST';
  if (c.alreadyInvited) return 'ALREADY_INVITED';
  return null;
}

/** Ranks eligible candidates by actual walking time, then reliability. */
export function rank(eligible: Candidate[], routes: WalkingRoute[], ctx: SelectionContext): Ranked[] {
  return eligible
    .map((candidate, i) => ({ candidate, route: routes[i]! }))
    .filter((r) => r.route && r.route.durationMin <= ctx.maxWalkingMinutes)
    .sort((a, b) => a.route.durationMin - b.route.durationMin || b.candidate.reliabilityScore - a.candidate.reliabilityScore || a.candidate.verifierId.localeCompare(b.candidate.verifierId))
    .slice(0, ctx.limit);
}

/** Next search tier: 15 → 20 → 30 → 45 minutes (configurable). Returns null when exhausted. */
export function nextTier(tiers: number[], current: number): number | null {
  return current + 1 < tiers.length ? current + 1 : null;
}
