import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY_RULES, type ChecklistInput } from '@avn/contracts';
import { evaluate, type EngineInput } from '../../src/modules/verification/engine';
import { aggregate, arrivalSignals, evidenceSignals, hamming } from '../../src/modules/fraud/rules';
import { exclusionReason, nextTier, rank, searchRadiusMetres, type Candidate, type SelectionContext } from '../../src/modules/assignments/engine';
import { validateArrival } from '../../src/modules/field/arrival';

const present: ChecklistInput = {
  applicantAvailable: 'YES',
  applicantConfirmedResidence: 'YES',
  occupantConfirmedResidence: 'UNKNOWN',
  anyoneAvailable: 'YES',
  contactRefused: 'NO',
  propertyAccessible: 'YES',
  addressMatchesDescription: 'YES',
  buildingExists: 'YES',
  occupancySigns: 'OCCUPIED',
  houseNumberVisible: true,
};
const base = (over: Partial<EngineInput> = {}): EngineInput => ({
  checklist: present,
  policy: DEFAULT_POLICY_RULES,
  arrival: { distanceM: 12, thresholdM: 50, withinThreshold: true, accuracyM: 8, exception: 'NONE' },
  evidence: { categoriesPresent: ['BUILDING_EXTERIOR', 'BUILDING_ENTRANCE', 'STREET_ENVIRONMENT'], count: 3, duplicates: 0 },
  applicantCodeConfirmed: false,
  supportingDocuments: 0,
  fraud: { score: 0, highSeverity: false },
  ...over,
});
const value = (r: ReturnType<typeof evaluate>, key: string) => r.findings.find((f) => f.key === key)!.value;

describe('verification engine', () => {
  it('verifies when building, address and residency are confirmed', () => {
    const r = evaluate(base());
    expect(r.outcome).toBe('VERIFIED');
    expect(r.findings).toHaveLength(7);
    expect(r.rulesVersion).toBe('avn-rules@1.0.0');
  });

  it('applicant absence is NOT a failed address — it yields partial verification', () => {
    const r = evaluate(base({ checklist: { ...present, applicantAvailable: 'NO', applicantConfirmedResidence: 'UNKNOWN', anyoneAvailable: 'NO' } }));
    expect(r.outcome).toBe('PARTIALLY_VERIFIED');
    expect(value(r, 'BUILDING_EXISTENCE')).toBe('CONFIRMED');
    expect(value(r, 'ADDRESS_MATCH')).toBe('CONFIRMED');
    expect(value(r, 'APPLICANT_PRESENCE')).toBe('NOT_CONFIRMED');
    expect(value(r, 'RESIDENCY_CONFIRMATION')).toBe('UNABLE_TO_DETERMINE');
  });

  it('a property existing does not establish residency', () => {
    const r = evaluate(base({ checklist: { ...present, applicantAvailable: 'NO', applicantConfirmedResidence: 'NO', occupantConfirmedResidence: 'NO' } }));
    expect(value(r, 'BUILDING_EXISTENCE')).toBe('CONFIRMED');
    expect(value(r, 'RESIDENCY_CONFIRMATION')).toBe('NOT_CONFIRMED');
    expect(r.outcome).not.toBe('VERIFIED');
  });

  it('uploaded documents and confirmation codes do not establish residence', () => {
    const r = evaluate(
      base({ supportingDocuments: 2, applicantCodeConfirmed: true, checklist: { ...present, applicantAvailable: 'NO', applicantConfirmedResidence: 'UNKNOWN', occupantConfirmedResidence: 'NO' } }),
    );
    expect(value(r, 'RESIDENCY_CONFIRMATION')).toBe('NOT_CONFIRMED');
    expect(value(r, 'CONTACTABILITY')).toBe('CONFIRMED');
    expect(r.outcome).toBe('PARTIALLY_VERIFIED');
  });

  it('occupant confirmation satisfies residency', () => {
    const r = evaluate(base({ checklist: { ...present, applicantAvailable: 'NO', applicantConfirmedResidence: 'UNKNOWN', occupantConfirmedResidence: 'YES' } }));
    expect(r.outcome).toBe('VERIFIED');
  });

  it('enforces institution presence policy', () => {
    const r = evaluate(base({ policy: { ...DEFAULT_POLICY_RULES, applicantPresenceRequired: true }, checklist: { ...present, applicantAvailable: 'NO', occupantConfirmedResidence: 'YES' } }));
    expect(r.outcome).toBe('PARTIALLY_VERIFIED');
  });

  it('contradicted building → not verified', () => {
    expect(evaluate(base({ checklist: { ...present, buildingExists: 'NO' } })).outcome).toBe('NOT_VERIFIED');
  });

  it('missing required evidence → inconclusive', () => {
    const r = evaluate(base({ evidence: { categoriesPresent: ['BUILDING_EXTERIOR'], count: 1, duplicates: 0 } }));
    expect(r.outcome).toBe('INCONCLUSIVE');
    expect(value(r, 'EVIDENCE_INTEGRITY')).toBe('NOT_CONFIRMED');
  });

  it('arrival outside threshold or poor GPS routes to manual review (never auto-reject)', () => {
    expect(evaluate(base({ arrival: { distanceM: 140, thresholdM: 50, withinThreshold: false, accuracyM: 10, exception: 'NONE' } })).outcome).toBe('MANUAL_REVIEW');
    expect(evaluate(base({ arrival: { distanceM: 30, thresholdM: 50, withinThreshold: true, accuracyM: 90, exception: 'POOR_GPS' } })).outcome).toBe('MANUAL_REVIEW');
  });

  it('inaccessible property is inconclusive, not failed', () => {
    const r = evaluate(
      base({
        arrival: { distanceM: 30, thresholdM: 50, withinThreshold: true, accuracyM: 10, exception: 'PROPERTY_INACCESSIBLE' },
        checklist: { ...present, buildingExists: 'UNKNOWN', addressMatchesDescription: 'UNKNOWN', applicantAvailable: 'NO', anyoneAvailable: 'NO', propertyAccessible: 'NO' },
      }),
    );
    expect(r.outcome).toBe('INCONCLUSIVE');
  });

  it('high fraud risk or duplicate evidence → manual review', () => {
    expect(evaluate(base({ fraud: { score: 70, highSeverity: false } })).outcome).toBe('MANUAL_REVIEW');
    expect(evaluate(base({ evidence: { categoriesPresent: ['BUILDING_EXTERIOR', 'BUILDING_ENTRANCE', 'STREET_ENVIRONMENT'], count: 3, duplicates: 1 } })).outcome).toBe('MANUAL_REVIEW');
  });

  it('is deterministic', () => {
    expect(evaluate(base())).toEqual(evaluate(base()));
  });
});

describe('arrival validation (GPS edge cases)', () => {
  const target = { lat: 6.6018, lng: 3.3515 };
  it('passes within 50 m', () => {
    expect(validateArrival(target, { lat: 6.6020, lng: 3.3516 }, 8, 50, 50).status).toBe('ARRIVED');
  });
  it('flags arrival outside threshold', () => {
    const r = validateArrival(target, { lat: 6.6040, lng: 3.3515 }, 8, 50, 50);
    expect(r.status).toBe('OUTSIDE_THRESHOLD');
    expect(r.distanceM).toBeGreaterThan(200);
  });
  it('flags poor GPS accuracy without rejecting', () => {
    const r = validateArrival(target, { lat: 6.6019, lng: 3.3515 }, 120, 50, 50);
    expect(r.status).toBe('POOR_ACCURACY');
    expect(r.withinThreshold).toBe(true);
  });
});

describe('fraud rules', () => {
  const now = new Date();
  const ev = { serverSha256: 'a', compressed: false, exactDuplicateElsewhere: false, similarElsewhere: null, capturedAt: now, receivedAt: now, point: { lat: 6.6018, lng: 3.3515 }, accuracyM: 6, target: { lat: 6.6018, lng: 3.3515 }, thresholdM: 50, maxAccuracyM: 50 };
  it('clean evidence raises nothing', () => expect(evidenceSignals(ev)).toEqual([]));
  it('detects duplicates and tampering', () => {
    const s = evidenceSignals({ ...ev, exactDuplicateElsewhere: true, clientSha256: 'b' });
    expect(s.map((x) => x.rule)).toEqual(['DUPLICATE_IMAGE', 'HASH_MISMATCH']);
    expect(aggregate(s)).toEqual({ score: 100, highSeverity: true });
  });
  it('ignores GPS jitter between close heartbeats', () => {
    const s = arrivalSignals({ accuracyM: 5, maxAccuracyM: 50, arrivalPoint: { lat: 6.6, lng: 3.35 }, arrivalAt: now, lastKnown: { point: { lat: 6.6004, lng: 3.35 }, at: new Date(now.getTime() - 1000) } });
    expect(s).toEqual([]);
  });
  it('detects impossible travel and mocked locations', () => {
    const s = arrivalSignals({ isMocked: true, accuracyM: 5, maxAccuracyM: 50, arrivalPoint: { lat: 6.6, lng: 3.35 }, arrivalAt: now, lastKnown: { point: { lat: 9.05, lng: 7.49 }, at: new Date(now.getTime() - 10 * 60_000) } });
    expect(s.map((x) => x.rule)).toEqual(['MOCK_LOCATION', 'IMPOSSIBLE_TRAVEL']);
  });
  it('computes dHash hamming distance', () => {
    expect(hamming('ff00ff00ff00ff00', 'ff00ff00ff00ff00')).toBe(0);
    expect(hamming('ff00ff00ff00ff00', 'ff00ff00ff00ff01')).toBe(1);
  });
});

describe('assignment candidate selection', () => {
  const now = new Date();
  const ctx: SelectionContext = { target: { lat: 6.6018, lng: 3.3515 }, maxWalkingMinutes: 15, heartbeatExpirySeconds: 180, now, applicantPhone: '+2348000000001', applicantUserId: 'applicant', limit: 2 };
  const cand = (over: Partial<Candidate>): Candidate => ({
    verifierId: 'v', userId: 'u', phone: '+2348000000099', status: 'APPROVED', isAvailable: true, lastHeartbeatAt: now, position: { lat: 6.603, lng: 3.352 }, home: null, reliabilityScore: 80, activeAssignments: 0, alreadyInvited: false, ...over,
  });
  it('excludes unapproved, unavailable, stale, busy and conflicted verifiers', () => {
    expect(exclusionReason(cand({ status: 'IDENTITY_PENDING' }), ctx)).toBe('NOT_APPROVED');
    expect(exclusionReason(cand({ status: 'SUSPENDED' }), ctx)).toBe('NOT_APPROVED');
    expect(exclusionReason(cand({ isAvailable: false }), ctx)).toBe('UNAVAILABLE');
    expect(exclusionReason(cand({ lastHeartbeatAt: new Date(now.getTime() - 10 * 60_000) }), ctx)).toBe('STALE_LOCATION');
    expect(exclusionReason(cand({ activeAssignments: 1 }), ctx)).toBe('BUSY');
    expect(exclusionReason(cand({ phone: '+2348000000001' }), ctx)).toBe('CONFLICT_OF_INTEREST');
    expect(exclusionReason(cand({ home: { lat: 6.6019, lng: 3.3515 } }), ctx)).toBe('CONFLICT_OF_INTEREST');
    expect(exclusionReason(cand({}), ctx)).toBeNull();
  });
  it('ranks by walking time then reliability and enforces the tier limit', () => {
    const a = cand({ verifierId: 'a', reliabilityScore: 90 });
    const b = cand({ verifierId: 'b', reliabilityScore: 70 });
    const c = cand({ verifierId: 'c' });
    const routes = [
      { distanceM: 600, durationMin: 8, source: 'valhalla' as const },
      { distanceM: 400, durationMin: 5, source: 'valhalla' as const },
      { distanceM: 2400, durationMin: 30, source: 'valhalla' as const },
    ];
    expect(rank([a, b, c], routes, ctx).map((r) => r.candidate.verifierId)).toEqual(['b', 'a']);
  });
  it('expands 15 → 20 → 30 → 45 and stops', () => {
    const tiers = [15, 20, 30, 45];
    expect(nextTier(tiers, 0)).toBe(1);
    expect(nextTier(tiers, 3)).toBeNull();
    expect(searchRadiusMetres(15)).toBe(1320);
  });
});
