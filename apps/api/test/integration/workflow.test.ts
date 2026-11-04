import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { client, consent, sampleAddress, sampleEvidenceJpeg, type Client } from '../../src/testing/fixtures';
import { runScenario } from '../../src/testing/scenario';
import { getApp, prisma, standardWorld } from '../helpers';

let alpha: Client;
beforeAll(async () => {
  ({ alpha } = await standardWorld());
});

describe('institution → applicant → verifier → report (end to end)', () => {
  it('produces a VERIFIED outcome, an issued report, ledger charge and verifier earning', async () => {
    const s = await runScenario({ app: getApp(), prisma, business: alpha, verifierEmail: 'verifier01@avn.local', target: { lat: 6.6031, lng: 3.3502 }, street: 'E2E Street', customerReference: 'E2E-1', applicantName: 'E2E Person', applicantPhone: '08020002001', seed: 21 });
    expect(s.status).toBe('COMPLETED');
    expect(s.outcome).toBe('VERIFIED');
    expect(s.reports).toHaveLength(1);
    const events = await prisma.requestStatusEvent.findMany({ where: { requestId: s.requestId }, orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => e.toStatus)).toEqual(['CREATED', 'AWAITING_APPLICANT', 'READY_FOR_ASSIGNMENT', 'DISPATCHING', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'VISIT_IN_PROGRESS', 'EVIDENCE_SUBMITTED', 'PROCESSING', 'COMPLETED']);
    const findings = await prisma.verificationFinding.findMany({ where: { requestId: s.requestId, supersededAt: null } });
    expect(findings).toHaveLength(7);
    const charge = await prisma.walletTransaction.findFirst({ where: { requestId: s.requestId, category: 'VERIFICATION_CHARGE' } });
    expect(charge?.amount.toFixed(2)).toBe('4500.00');
    const earning = await prisma.walletTransaction.findFirst({ where: { requestId: s.requestId, category: 'VERIFICATION_EARNING' } });
    expect(earning?.amount.toFixed(2)).toBe('2000.00');

    // Applicant tracking view and PDF access.
    const t = await s.applicant!.get(`/me/requests/${s.requestId}`);
    expect(t.body.timeline.every((x: { done: boolean }) => x.done)).toBe(true);
    expect(t.body.price).toBeNull(); // institution pricing is restricted
    const pdf = await s.applicant!.get(`/reports/${s.reports![0]!.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');

    // Public authenticity: outcome only disclosed with hash proof.
    const ref = s.reports![0]!.reference;
    const bare = await request(getApp()).get(`/api/v1/reports/verify/${ref}`);
    expect(bare.body).toMatchObject({ valid: true, status: 'VALID' });
    expect(bare.body.outcome).toBeUndefined();
    const proved = await request(getApp()).get(`/api/v1/reports/verify/${ref}?h=${s.reports![0]!.contentHash.slice(0, 16)}`);
    expect(proved.body.outcome).toBe('VERIFIED');
  });

  it('applicant absence yields PARTIALLY_VERIFIED, never NOT_VERIFIED, and the verifier is still paid', async () => {
    const s = await runScenario({ app: getApp(), prisma, business: alpha, verifierEmail: 'verifier02@avn.local', target: { lat: 6.6061, lng: 3.3532 }, street: 'Absent Street', customerReference: 'E2E-2', applicantName: 'Absent Person', applicantPhone: '08020002002', absent: true, seed: 22 });
    expect(s.outcome).toBe('PARTIALLY_VERIFIED');
    expect(await prisma.walletTransaction.count({ where: { requestId: s.requestId, category: 'VERIFICATION_EARNING' } })).toBe(1);
  });

  it('arrival outside the threshold goes to manual review; a reviewer resolves it and a report is issued', async () => {
    const s = await runScenario({ app: getApp(), prisma, business: alpha, verifierEmail: 'verifier03@avn.local', target: { lat: 6.5991, lng: 3.3462 }, street: 'Far Street', customerReference: 'E2E-3', applicantName: 'Far Person', applicantPhone: '08020002003', arrivalOffsetLat: 0.003, seed: 23 });
    expect(s.status).toBe('MANUAL_REVIEW');
    const reviewer = client(getApp(), 'admin');
    await reviewer.login('reviewer@avn.local');
    const queue = await reviewer.get('/admin/reviews');
    const review = queue.body.find((r: { requestId: string }) => r.requestId === s.requestId);
    expect(review.reasons.join(' ')).toMatch(/outside the configured threshold/);
    await reviewer.post(`/admin/reviews/${review.id}/notes`, { note: 'Pin was placed on the estate gate; photos confirm the house.' });
    const res = await reviewer.post(`/admin/reviews/${review.id}/resolve`, { outcome: 'VERIFIED', note: 'Confirmed from evidence', findingOverrides: [{ key: 'ADDRESS_MATCH', value: 'CONFIRMED', note: 'Gate pin' }] });
    expect(res.status).toBe(200);
    const r = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: s.requestId }, include: { reports: true } });
    expect(r.status).toBe('COMPLETED');
    expect(r.reports).toHaveLength(1);
  });

  it('upheld disputes reopen a completed request into manual review', async () => {
    const s = await runScenario({ app: getApp(), prisma, business: alpha, verifierEmail: 'verifier04@avn.local', target: { lat: 6.6081, lng: 3.3482 }, street: 'Dispute Street', customerReference: 'E2E-4', applicantName: 'Dispute Person', applicantPhone: '08020002004', seed: 24 });
    const d = await s.applicant!.post(`/me/requests/${s.requestId}/disputes`, { reason: 'Wrong flat', details: 'The verifier photographed the wrong block.' });
    expect(d.status).toBe(200);
    const admin = client(getApp(), 'admin');
    await admin.login('reviewer@avn.local');
    expect((await admin.post(`/admin/disputes/${d.body.id}/resolve`, { decision: 'UPHELD', resolutionNote: 'Re-check required' })).status).toBe(200);
    expect((await prisma.verificationRequest.findUniqueOrThrow({ where: { id: s.requestId } })).status).toBe('MANUAL_REVIEW');
  });
});

describe('applicant input validation', () => {
  it('rejects invalid map coordinates and missing consent', async () => {
    const s = await runScenario({ app: getApp(), prisma, business: alpha, verifierEmail: '', target: { lat: 6.6, lng: 3.35 }, street: 'x', customerReference: 'VAL-1', applicantName: 'Val', applicantPhone: '08020002101', seed: 31, stopAfter: 'created' });
    const token = s.invitationUrl!.split('/invite/')[1]!;
    const a = client(getApp(), 'applicant');
    const otp = await a.post(`/invitations/${token}/otp`);
    await a.post(`/invitations/${token}/verify`, { code: otp.body.devCode });
    const nullIsland = await a.post(`/me/requests/${s.requestId}/submit`, { fullName: 'Val', address: sampleAddress({ lat: 0, lng: 0 }, 'Zero St'), consent });
    expect(nullIsland.status).toBe(422);
    expect(nullIsland.body.error.code).toBe('INVALID_COORDINATES');
    const outOfRange = await a.post(`/me/requests/${s.requestId}/submit`, { fullName: 'Val', address: { ...sampleAddress({ lat: 6.6, lng: 3.35 }, 'X'), lat: 123 }, consent });
    expect(outOfRange.status).toBe(400);
    const noConsent = await a.post(`/me/requests/${s.requestId}/submit`, { fullName: 'Val', address: sampleAddress({ lat: 6.6, lng: 3.35 }, 'X'), consent: { ...consent, visitAuthorised: false } });
    expect(noConsent.status).toBe(400);
    // Guest sessions are restricted to their own invitation.
    expect((await a.get('/me/requests')).body).toHaveLength(1);
  });

  it('accepts real documents and rejects disguised or oversized files (MIME by magic bytes)', async () => {
    const s = await runScenario({ app: getApp(), prisma, business: alpha, verifierEmail: '', target: { lat: 6.6, lng: 3.35 }, street: 'x', customerReference: 'DOC-1', applicantName: 'Doc', applicantPhone: '08020002102', seed: 32, stopAfter: 'created' });
    const token = s.invitationUrl!.split('/invite/')[1]!;
    const a = client(getApp(), 'applicant');
    const otp = await a.post(`/invitations/${token}/otp`);
    await a.post(`/invitations/${token}/verify`, { code: otp.body.devCode });
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    expect((await a.upload(`/me/requests/${s.requestId}/documents`, 'file', pdf, 'bill.pdf', { documentType: 'UTILITY_BILL' })).status).toBe(200);
    const fake = await a.upload(`/me/requests/${s.requestId}/documents`, 'file', Buffer.from('<script>alert(1)</script> pretending to be a pdf'), 'bill.pdf', { documentType: 'UTILITY_BILL' });
    expect(fake.status).toBe(400);
    const big = await a.upload(`/me/requests/${s.requestId}/documents`, 'file', Buffer.alloc(13 * 1024 * 1024, 1), 'big.pdf', { documentType: 'OTHER' });
    expect(big.status).toBe(413);
  });
});

describe('field evidence rules', () => {
  it('rejects gallery uploads as primary evidence and flags duplicate images across requests', async () => {
    const s1 = await runScenario({ app: getApp(), prisma, business: alpha, verifierEmail: 'verifier01@avn.local', target: { lat: 6.6111, lng: 3.3512 }, street: 'Dup St', customerReference: 'DUP-1', applicantName: 'Dup One', applicantPhone: '08020002201', seed: 41, stopAfter: 'arrived' });
    const img = await sampleEvidenceJpeg('DUP', 4242);
    const meta = { category: 'BUILDING_EXTERIOR', lat: 6.6112, lng: 3.3512, accuracyM: 6, capturedAt: new Date().toISOString(), deviceId: 'dev-1', captureSource: 'CAMERA' };
    const gallery = await s1.verifier!.upload(`/assignments/${s1.assignmentId}/evidence`, 'file', img, 'a.jpg', { ...meta, captureSource: 'GALLERY' });
    expect(gallery.status).toBe(400);
    const first = await s1.verifier!.upload(`/assignments/${s1.assignmentId}/evidence`, 'file', img, 'a.jpg', meta);
    expect(first.status).toBe(200);
    // Retrying the same upload is idempotent (resumable after connectivity loss).
    const retry = await s1.verifier!.upload(`/assignments/${s1.assignmentId}/evidence`, 'file', img, 'a.jpg', meta);
    expect(retry.body.duplicateRetry).toBe(true);
    await s1.verifier!.post('/verifiers/me/availability', { available: false });

    const s2 = await runScenario({ app: getApp(), prisma, business: alpha, verifierEmail: 'verifier02@avn.local', target: { lat: 6.6141, lng: 3.3542 }, street: 'Dup St 2', customerReference: 'DUP-2', applicantName: 'Dup Two', applicantPhone: '08020002202', seed: 42, stopAfter: 'arrived' });
    const reused = await s2.verifier!.upload(`/assignments/${s2.assignmentId}/evidence`, 'file', img, 'a.jpg', { ...meta, lat: 6.6142, lng: 3.3542 });
    expect(reused.status).toBe(200);
    expect(reused.body.integrity.map((x: { rule: string }) => x.rule)).toContain('DUPLICATE_IMAGE');
    await s2.verifier!.post('/verifiers/me/availability', { available: false });
  });

  it('blocks submission until required evidence exists and prevents duplicate submission', async () => {
    const s = await runScenario({ app: getApp(), prisma, business: alpha, verifierEmail: 'verifier03@avn.local', target: { lat: 6.6171, lng: 3.3572 }, street: 'Sub St', customerReference: 'SUB-1', applicantName: 'Sub', applicantPhone: '08020002301', seed: 43, stopAfter: 'arrived' });
    const { presentChecklist } = await import('../../src/testing/fixtures');
    const early = await s.verifier!.post(`/assignments/${s.assignmentId}/submit`, { checklist: presentChecklist, idempotencyKey: 'sub-key-1' });
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('EVIDENCE_REQUIRED');
    // Draft saving with last-writer-wins.
    const d1 = await s.verifier!.put(`/assignments/${s.assignmentId}/draft`, { checklist: { buildingExists: 'YES' }, clientUpdatedAt: new Date().toISOString() });
    expect(d1.body.saved).toBe(true);
    const stale = await s.verifier!.put(`/assignments/${s.assignmentId}/draft`, { checklist: { buildingExists: 'NO' }, clientUpdatedAt: new Date(Date.now() - 60_000).toISOString() });
    expect(stale.body.saved).toBe(false);
    for (const [i, category] of ['BUILDING_EXTERIOR', 'BUILDING_ENTRANCE', 'STREET_ENVIRONMENT'].entries()) {
      await s.verifier!.upload(`/assignments/${s.assignmentId}/evidence`, 'file', await sampleEvidenceJpeg(category, 900 + i), 'e.jpg', { category, lat: 6.6172, lng: 3.3572, accuracyM: 5, capturedAt: new Date().toISOString(), deviceId: 'dev-3', captureSource: 'CAMERA' });
    }
    const ok = await s.verifier!.post(`/assignments/${s.assignmentId}/submit`, { checklist: presentChecklist, idempotencyKey: 'sub-key-1' });
    expect(ok.status).toBe(200);
    const replay = await s.verifier!.post(`/assignments/${s.assignmentId}/submit`, { checklist: presentChecklist, idempotencyKey: 'sub-key-1' });
    expect(replay.body.replay).toBe(true);
    const dup = await s.verifier!.post(`/assignments/${s.assignmentId}/submit`, { checklist: presentChecklist, idempotencyKey: 'sub-key-2' });
    expect(dup.status).toBe(409);
  });
});
