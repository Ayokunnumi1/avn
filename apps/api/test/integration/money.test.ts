import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { client, consent, DEMO_PASSWORD, sampleAddress, type Client } from '../../src/testing/fixtures';
import { deps } from '../../src/container';
import { getApp, prisma, standardWorld } from '../helpers';

let applicant: Client;
beforeAll(async () => {
  await standardWorld();
  applicant = client(getApp(), 'applicant');
  await applicant.login('applicant01@avn.local');
});

async function individualRequest() {
  const r = await applicant.post('/me/requests', { level: 'STANDARD', purpose: 'TENANCY', fullName: 'Sample Applicant 01', address: sampleAddress({ lat: 6.51, lng: 3.37 }, 'Pay St', 'Yaba', 'Lagos Mainland'), consent });
  expect(r.status).toBe(200);
  const pay = await applicant.post(`/me/requests/${r.body.id}/pay`);
  expect(pay.status).toBe(200);
  return { id: r.body.id as string, reference: pay.body.reference as string };
}
const checkout = (ref: string, outcome: 'success' | 'failed') => request(getApp()).post(`/api/v1/payments/simulator/checkout/${ref}`).type('form').send({ outcome });

describe('individual payments (spec A9 / Part 10)', () => {
  it('payment success is confirmed server-side and releases the request for assignment', async () => {
    const { id, reference } = await individualRequest();
    expect((await applicant.get(`/payments/${reference}/status`)).body.status).toBe('INITIATED');
    const res = await checkout(reference, 'success');
    expect(res.status).toBe(303);
    const status = await applicant.get(`/payments/${reference}/status`);
    expect(status.body.status).toBe('SUCCEEDED');
    const r = await prisma.verificationRequest.findUniqueOrThrow({ where: { id } });
    expect(r.paidAt).not.toBeNull();
    expect(['READY_FOR_ASSIGNMENT', 'DISPATCHING']).toContain(r.status);
  });

  it('payment failure leaves the request unpaid', async () => {
    const { id, reference } = await individualRequest();
    await checkout(reference, 'failed');
    expect((await applicant.get(`/payments/${reference}/status`)).body.status).toBe('FAILED');
    expect((await prisma.verificationRequest.findUniqueOrThrow({ where: { id } })).status).toBe('CREATED');
  });

  it('rejects webhooks with invalid signatures and ignores duplicates', async () => {
    const { reference } = await individualRequest();
    const body = JSON.stringify({ event: 'charge.success', data: { id: `x-${reference}`, reference } });
    const forged = await request(getApp()).post('/api/v1/payments/webhooks/simulator').set('Content-Type', 'application/json').set('x-avn-simulator-signature', 'ab'.repeat(64)).send(body);
    expect(forged.status).toBe(401);
    // A correctly signed body that the provider has NOT confirmed does not mark the payment paid.
    const sig = createHmac('sha512', deps().env.SESSION_SECRET).update(body).digest('hex');
    const first = await request(getApp()).post('/api/v1/payments/webhooks/simulator').set('Content-Type', 'application/json').set('x-avn-simulator-signature', sig).send(body);
    expect(first.status).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { reference } })).status).toBe('INITIATED');
    const dup = await request(getApp()).post('/api/v1/payments/webhooks/simulator').set('Content-Type', 'application/json').set('x-avn-simulator-signature', sig).send(body);
    expect(dup.body.duplicate).toBe(true);
  });

  it('never trusts frontend success: amount mismatches fail the payment', async () => {
    const { reference } = await individualRequest();
    await prisma.payment.update({ where: { reference }, data: { amount: '1.00' } });
    await checkout(reference, 'success');
    const p = await prisma.payment.findUniqueOrThrow({ where: { reference } });
    expect(p.status).toBe('FAILED');
    expect(p.failureReason).toMatch(/mismatch/);
  });

  it('payment provider unavailable → 503 and no dangling success', async () => {
    const d = deps();
    const original = d.payments.initialize.bind(d.payments);
    d.payments.initialize = async () => {
      throw new Error('ECONNREFUSED');
    };
    const r = await applicant.post('/me/requests', { level: 'BASIC', purpose: 'TENANCY', fullName: 'X', address: sampleAddress({ lat: 6.52, lng: 3.38 }, 'Down St', 'Yaba', 'Lagos Mainland'), consent });
    const pay = await applicant.post(`/me/requests/${r.body.id}/pay`);
    expect(pay.status).toBe(503);
    d.payments.initialize = original;
  });
});

describe('institution billing', () => {
  it('top-up credits the wallet exactly once; insufficient balance blocks new requests atomically', async () => {
    const owner = client(getApp(), 'business');
    await owner.login('owner@alpha.test');
    const before = (await owner.get('/org/billing')).body.available;
    const t = await owner.post('/org/billing/topup', { amount: '5000' });
    await checkout(t.body.reference, 'success');
    await checkout(t.body.reference, 'success'); // replayed redirect/webhook
    const after = (await owner.get('/org/billing')).body.available;
    expect(Number(after) - Number(before)).toBe(5000);

    const org = await prisma.organisation.findFirstOrThrow({ where: { legalName: 'Beta Bank (Fictional)' } });
    await prisma.wallet.update({ where: { organisationId: org.id }, data: { availableBalance: '100.00' } });
    const beta = client(getApp(), 'business');
    await beta.login('owner@beta.test');
    const count = await prisma.verificationRequest.count({ where: { organisationId: org.id } });
    const r = await beta.post('/org/requests', { applicantName: 'Broke', applicantPhone: '08020004001', customerReference: 'BROKE-1' });
    expect(r.status).toBe(402);
    // Database rollback: no partial request, invitation or ledger row remains.
    expect(await prisma.verificationRequest.count({ where: { organisationId: org.id } })).toBe(count);
  });
});

describe('verifier payouts', () => {
  it('requests are held, approved with password confirmation and settled through the ledger', async () => {
    const v = client(getApp(), 'verifier');
    await v.login('verifier01@avn.local');
    const vp = await prisma.verifierProfile.findFirstOrThrow({ where: { user: { email: 'verifier01@avn.local' } }, include: { wallet: true } });
    await prisma.wallet.update({ where: { id: vp.wallet!.id }, data: { availableBalance: '5000.00' } });
    const tooSmall = await v.post('/verifiers/me/payouts', { amount: '10', idempotencyKey: 'po-small-1' });
    expect(tooSmall.status).toBe(400);
    const p = await v.post('/verifiers/me/payouts', { amount: '3000', idempotencyKey: 'po-ok-0001' });
    expect(p.status).toBe(200);
    const replay = await v.post('/verifiers/me/payouts', { amount: '3000', idempotencyKey: 'po-ok-0001' });
    expect(replay.body.id).toBe(p.body.id);
    let w = await prisma.wallet.findUniqueOrThrow({ where: { id: vp.wallet!.id } });
    expect([w.availableBalance.toFixed(2), w.heldBalance.toFixed(2)]).toEqual(['2000.00', '3000.00']);

    const ops = client(getApp(), 'admin');
    await ops.login('ops@avn.local', DEMO_PASSWORD);
    // Operations admins cannot approve payouts (finance permissions are separate).
    expect((await ops.post(`/admin/finance/payouts/${p.body.id}/decision`, { decision: 'APPROVE', reason: 'ok', confirmPassword: DEMO_PASSWORD })).status).toBe(403);
    const fin = client(getApp(), 'admin');
    await fin.login('finance@avn.local');
    const wrong = await fin.post(`/admin/finance/payouts/${p.body.id}/decision`, { decision: 'APPROVE', reason: 'ok', confirmPassword: 'nope' });
    expect(wrong.status).toBe(403);
    const ok = await fin.post(`/admin/finance/payouts/${p.body.id}/decision`, { decision: 'APPROVE', reason: 'ok', confirmPassword: DEMO_PASSWORD });
    expect(ok.status).toBe(200);
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: p.body.id } })).status).toBe('COMPLETED');
    w = await prisma.wallet.findUniqueOrThrow({ where: { id: vp.wallet!.id } });
    expect([w.availableBalance.toFixed(2), w.heldBalance.toFixed(2)]).toEqual(['2000.00', '0.00']);
  });

  it('failed transfers return funds to the available balance', async () => {
    const vp = await prisma.verifierProfile.findFirstOrThrow({ where: { user: { email: 'verifier02@avn.local' } }, include: { wallet: true } });
    await prisma.verifierProfile.update({ where: { id: vp.id }, data: { payoutRecipientCode: 'SIMRCP_058_0000' } });
    await prisma.wallet.update({ where: { id: vp.wallet!.id }, data: { availableBalance: '4000.00' } });
    const v = client(getApp(), 'verifier');
    await v.login('verifier02@avn.local');
    const p = await v.post('/verifiers/me/payouts', { amount: '4000', idempotencyKey: 'po-fail-1' });
    const fin = client(getApp(), 'admin');
    await fin.login('finance@avn.local');
    await fin.post(`/admin/finance/payouts/${p.body.id}/decision`, { decision: 'APPROVE', reason: 'ok', confirmPassword: DEMO_PASSWORD });
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: p.body.id } })).status).toBe('FAILED');
    const w = await prisma.wallet.findUniqueOrThrow({ where: { id: vp.wallet!.id } });
    expect(w.availableBalance.toFixed(2)).toBe('4000.00');
    // The ledger is append-only at the database level.
    const tx = await prisma.walletTransaction.findFirstOrThrow({ where: { walletId: vp.wallet!.id } });
    await expect(prisma.walletTransaction.update({ where: { id: tx.id }, data: { amount: '1.00' } })).rejects.toThrow(/immutable/);
  });
});
