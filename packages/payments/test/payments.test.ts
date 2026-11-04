import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PaystackPaymentProvider, SimulatorPaymentProvider, SimulatorPayoutProvider } from '../src';

describe('Paystack webhook signatures', () => {
  const provider = new PaystackPaymentProvider('sk_test_secret');
  const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { id: 99, reference: 'AVN-PAY-1' } }));
  const good = createHmac('sha512', 'sk_test_secret').update(body).digest('hex');

  it('accepts a correctly signed body', () => {
    expect(provider.verifyWebhookSignature(body, { 'x-paystack-signature': good })).toBe(true);
  });
  it('rejects tampered bodies, wrong keys and missing headers', () => {
    const tampered = Buffer.from(body.toString().replace('AVN-PAY-1', 'AVN-PAY-2'));
    expect(provider.verifyWebhookSignature(tampered, { 'x-paystack-signature': good })).toBe(false);
    const wrong = createHmac('sha512', 'other').update(body).digest('hex');
    expect(provider.verifyWebhookSignature(body, { 'x-paystack-signature': wrong })).toBe(false);
    expect(provider.verifyWebhookSignature(body, {})).toBe(false);
    expect(provider.verifyWebhookSignature(body, { 'x-paystack-signature': 'not-hex' })).toBe(false);
  });
  it('derives a stable idempotency key per event', () => {
    const e = provider.parseWebhook(JSON.parse(body.toString()));
    expect(e.eventKey).toBe('charge.success:99');
    expect(e.reference).toBe('AVN-PAY-1');
  });
});

describe('simulator', () => {
  it('only reports success after checkout completion, with a verifiable signed webhook', async () => {
    const sim = new SimulatorPaymentProvider('x'.repeat(40), 'http://localhost/checkout');
    await sim.initialize({ reference: 'R1', amountMinor: 500000, currency: 'NGN', email: 'a@b.c', callbackUrl: 'http://cb' });
    expect((await sim.verify('R1')).status).toBe('pending');
    const { body, signature } = sim.complete('R1', true);
    expect(sim.verifyWebhookSignature(Buffer.from(body), { 'x-avn-simulator-signature': signature })).toBe(true);
    const v = await sim.verify('R1');
    expect(v.status).toBe('success');
    expect(v.amountMinor).toBe(500000);
  });
  it('simulated payouts fail for accounts ending 0000', async () => {
    const p = new SimulatorPayoutProvider();
    const ok = await p.createRecipient({ name: 'A', accountNumber: '0123456789', bankCode: '058' });
    const bad = await p.createRecipient({ name: 'B', accountNumber: '0123450000', bankCode: '058' });
    expect((await p.transfer({ amountMinor: 1, recipientCode: ok.recipientCode, reference: 'x', reason: 'r' })).status).toBe('success');
    expect((await p.transfer({ amountMinor: 1, recipientCode: bad.recipientCode, reference: 'y', reason: 'r' })).status).toBe('failed');
  });
});
