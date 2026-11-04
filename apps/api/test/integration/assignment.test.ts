import { beforeAll, describe, expect, it } from 'vitest';
import { client, type Client } from '../../src/testing/fixtures';
import { runScenario } from '../../src/testing/scenario';
import { dispatchRequest } from '../../src/modules/assignments/dispatch';
import { maintenanceTick } from '../../src/jobs/maintenance';
import { getApp, prisma, standardWorld } from '../helpers';

let alpha: Client;
beforeAll(async () => {
  ({ alpha } = await standardWorld());
});

async function readyRequest(ref: string, target: { lat: number; lng: number }, phone: string) {
  const s = await runScenario({ app: getApp(), prisma, business: alpha, verifierEmail: '', target, street: 'Engine St', customerReference: ref, applicantName: `Engine ${ref}`, applicantPhone: phone, seed: 50, stopAfter: 'submitted' });
  await prisma.assignmentInvitation.deleteMany({ where: { requestId: s.requestId } });
  return s.requestId;
}
async function goAvailable(email: string, p: { lat: number; lng: number }) {
  const v = client(getApp(), 'verifier');
  await v.login(email);
  const r = await v.post('/verifiers/me/availability', { available: true, lat: p.lat, lng: p.lng, accuracyM: 10 });
  return { v, sessionId: r.body.sessionId as string, status: r.status };
}
const offOthers = () => prisma.verifierAvailability.updateMany({ data: { isAvailable: false } });
/** Going available triggers an immediate redispatch; clear it so the engine call under test starts clean. */
const fresh = async (id: string) => {
  await prisma.assignmentInvitation.deleteMany({ where: { requestId: id } });
  await prisma.verificationRequest.update({ where: { id }, data: { dispatchTier: 0, coverageFallback: null, status: 'READY_FOR_ASSIGNMENT' } });
};

describe('verifier eligibility', () => {
  it('unapproved verifiers cannot go available or receive assignments', async () => {
    const v = client(getApp(), 'verifier');
    await v.login('verifier09@avn.local');
    const r = await v.post('/verifiers/me/availability', { available: true, lat: 6.6, lng: 3.35, accuracyM: 5 });
    expect(r.status).toBe(403);
  });

  it('stale locations are excluded and heartbeats expire automatically', async () => {
    await offOthers();
    const target = { lat: 6.62, lng: 3.36 };
    const id = await readyRequest('STALE-1', target, '08020003001');
    const { v, sessionId } = await goAvailable('verifier01@avn.local', { lat: 6.621, lng: 3.36 });
    const hb = await v.post('/verifiers/me/heartbeat', { lat: 6.621, lng: 3.3601, accuracyM: 9, sessionId });
    expect(hb.status).toBe(200);
    await prisma.verifierAvailability.updateMany({ data: { lastHeartbeatAt: new Date(Date.now() - 10 * 60_000) } });
    await fresh(id);
    const out = await dispatchRequest(id);
    expect(out.invited).toBe(0);
    const stats = await maintenanceTick();
    expect(stats.heartbeatsExpired).toBeGreaterThanOrEqual(1);
    const me = await v.get('/verifiers/me');
    expect(me.body.availability.available).toBe(false);
    expect((await v.post('/verifiers/me/heartbeat', { lat: 6.621, lng: 3.36, accuracyM: 9, sessionId })).body.error.code).toBe('DUTY_SESSION_ENDED');
  });
});

describe('proximity selection and search expansion', () => {
  it('only invites verifiers within the walking tier, expanding 15 → 20 → 30 → 45 minutes', async () => {
    await offOthers();
    const target = { lat: 6.64, lng: 3.38 };
    const id = await readyRequest('TIER-1', target, '08020003002');
    // ~2.0 km away ⇒ estimate ≈ 2.6 km walk ≈ 33 min: outside 15/20/30, inside 45.
    await goAvailable('verifier02@avn.local', { lat: 6.658, lng: 3.38 });
    await fresh(id);
    const out = await dispatchRequest(id);
    expect(out.invited).toBe(1);
    expect(out.tierMinutes).toBe(45);
    const inv = await prisma.assignmentInvitation.findFirstOrThrow({ where: { requestId: id } });
    expect(Number(inv.walkingMinutes)).toBeGreaterThan(30);
    expect(inv.routingSource).toBe('estimate');
  });

  it('offers no coverage fallback when nobody is within 45 minutes', async () => {
    await offOthers();
    const id = await readyRequest('NOCOV-1', { lat: 9.06, lng: 7.49 }, '08020003003');
    const out = await dispatchRequest(id);
    expect(out.exhausted).toBe(true);
    const r = await prisma.verificationRequest.findUniqueOrThrow({ where: { id } });
    expect(r.coverageFallback).toContain('PROFESSIONAL_AGENT');
  });

  it('hides precise address before acceptance', async () => {
    await offOthers();
    const target = { lat: 6.66, lng: 3.4 };
    const id = await readyRequest('PRIV-1', target, '08020003004');
    const { v } = await goAvailable('verifier03@avn.local', { lat: 6.661, lng: 3.4 });
    await fresh(id);
    await dispatchRequest(id);
    const offers = await v.get('/verifiers/me/offers');
    const o = offers.body[0];
    expect(o.generalLocation).toContain('Ikeja');
    expect(JSON.stringify(o)).not.toContain('Engine St');
    expect(o.approxPoint).toEqual({ lat: 6.66, lng: 3.4 });
  });
});

describe('assignment concurrency (spec §5.6)', () => {
  it('two verifiers accepting the same job concurrently → exactly one wins', async () => {
    await offOthers();
    const target = { lat: 6.68, lng: 3.42 };
    const id = await readyRequest('RACE-1', target, '08020003005');
    const a = await goAvailable('verifier01@avn.local', { lat: 6.681, lng: 3.42 });
    const b = await goAvailable('verifier04@avn.local', { lat: 6.679, lng: 3.42 });
    await fresh(id);
    const out = await dispatchRequest(id);
    expect(out.invited).toBe(2);
    const [oa] = (await a.v.get('/verifiers/me/offers')).body;
    const [ob] = (await b.v.get('/verifiers/me/offers')).body;
    const [ra, rb] = await Promise.all([a.v.post(`/offers/${oa.id}/accept`, { idempotencyKey: 'race-a-1' }), b.v.post(`/offers/${ob.id}/accept`, { idempotencyKey: 'race-b-1' })]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(await prisma.verificationAssignment.count({ where: { requestId: id, status: 'ACCEPTED' } })).toBe(1);
    // Duplicate acceptance by the winner is idempotent.
    const winner = ra.status === 200 ? { c: a.v, id: oa.id, key: 'race-a-1' } : { c: b.v, id: ob.id, key: 'race-b-1' };
    const again = await winner.c.post(`/offers/${winner.id}/accept`, { idempotencyKey: winner.key });
    expect(again.status).toBe(200);
    expect(await prisma.verificationAssignment.count({ where: { requestId: id } })).toBe(1);
    await prisma.verifierAvailability.updateMany({ data: { isAvailable: false } });
  });

  it('expired offers are re-dispatched by the maintenance sweep', async () => {
    await offOthers();
    const target = { lat: 6.7, lng: 3.44 };
    const id = await readyRequest('EXP-1', target, '08020003006');
    await goAvailable('verifier02@avn.local', { lat: 6.701, lng: 3.44 });
    await fresh(id);
    await dispatchRequest(id);
    await prisma.assignmentInvitation.updateMany({ where: { requestId: id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await goAvailable('verifier03@avn.local', { lat: 6.699, lng: 3.44 });
    await maintenanceTick();
    const invites = await prisma.assignmentInvitation.findMany({ where: { requestId: id } });
    expect(invites.some((i) => i.status === 'EXPIRED')).toBe(true);
    expect(invites.some((i) => i.status === 'SENT')).toBe(true);
  });
});
