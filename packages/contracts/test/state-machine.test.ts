import { describe, expect, it } from 'vitest';
import { REQUEST_STATUSES } from '../src/enums';
import { REQUEST_TRANSITIONS, assertTransition, canTransition, FINAL_REQUEST_STATUSES, IllegalTransitionError } from '../src/state-machine';
import { ORG_ROLE_PERMISSIONS, orgRoleHas, adminRoleHas } from '../src/permissions';
import { checklistSchema, coordinateSchema, evidenceMetaSchema, passwordSchema } from '../src/schemas';

describe('request state machine', () => {
  it('defines transitions for every status, only to known statuses', () => {
    for (const s of REQUEST_STATUSES) {
      expect(REQUEST_TRANSITIONS[s]).toBeDefined();
      for (const t of REQUEST_TRANSITIONS[s]) expect(REQUEST_STATUSES).toContain(t);
    }
  });
  it('allows the happy path end to end', () => {
    const path = ['CREATED', 'AWAITING_APPLICANT', 'READY_FOR_ASSIGNMENT', 'DISPATCHING', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'VISIT_IN_PROGRESS', 'EVIDENCE_SUBMITTED', 'PROCESSING', 'COMPLETED'] as const;
    for (let i = 1; i < path.length; i++) expect(() => assertTransition(path[i - 1]!, path[i]!)).not.toThrow();
  });
  it('rejects arbitrary jumps', () => {
    expect(canTransition('CREATED', 'COMPLETED')).toBe(false);
    expect(canTransition('DISPATCHING', 'EVIDENCE_SUBMITTED')).toBe(false);
    expect(() => assertTransition('AWAITING_APPLICANT', 'COMPLETED')).toThrow(IllegalTransitionError);
  });
  it('treats cancelled and expired as terminal', () => {
    expect(REQUEST_TRANSITIONS.CANCELLED).toHaveLength(0);
    expect(REQUEST_TRANSITIONS.EXPIRED).toHaveLength(0);
    expect(FINAL_REQUEST_STATUSES).toContain('COMPLETED');
  });
  it('never lets evidence submission skip processing', () => {
    expect(REQUEST_TRANSITIONS.EVIDENCE_SUBMITTED).toEqual(['PROCESSING']);
  });
});

describe('permissions', () => {
  it('owners hold every permission; auditors are read-only', () => {
    expect(orgRoleHas('OWNER', 'org.manage')).toBe(true);
    expect(ORG_ROLE_PERMISSIONS.AUDITOR.some((p) => p.endsWith('.create') || p.endsWith('.manage'))).toBe(false);
    expect(orgRoleHas('FINANCE_OFFICER', 'requests.create')).toBe(false);
  });
  it('separates finance from operations', () => {
    expect(adminRoleHas('OPERATIONS', 'payouts.approve')).toBe(false);
    expect(adminRoleHas('FINANCE', 'payouts.approve')).toBe(true);
    expect(adminRoleHas('SUPPORT', 'verifiers.review')).toBe(false);
  });
});

describe('schemas', () => {
  it('rejects null-island coordinates', () => {
    expect(coordinateSchema.safeParse({ lat: 0, lng: 0 }).success).toBe(false);
    expect(coordinateSchema.safeParse({ lat: 6.45, lng: 3.39 }).success).toBe(true);
  });
  it('requires camera capture for primary evidence', () => {
    const base = { category: 'BUILDING_EXTERIOR', lat: 6.4, lng: 3.4, accuracyM: 8, capturedAt: new Date().toISOString(), deviceId: 'device-1' };
    expect(evidenceMetaSchema.safeParse({ ...base, captureSource: 'GALLERY' }).success).toBe(false);
    expect(evidenceMetaSchema.safeParse({ ...base, captureSource: 'CAMERA' }).success).toBe(true);
  });
  it('enforces password strength', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('Str0ngPassword').success).toBe(true);
  });
  it('accepts an applicant-absent checklist (absence is not invalidity)', () => {
    const r = checklistSchema.safeParse({
      applicantAvailable: 'NO', applicantConfirmedResidence: 'UNKNOWN', occupantConfirmedResidence: 'NO', anyoneAvailable: 'NO',
      contactRefused: 'NO', propertyAccessible: 'YES', addressMatchesDescription: 'YES', buildingExists: 'YES', occupancySigns: 'OCCUPIED',
    });
    expect(r.success).toBe(true);
  });
});
