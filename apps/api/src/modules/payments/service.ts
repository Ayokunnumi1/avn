import { Prisma, type PaymentPurpose } from '@avn/database';
import { SimulatorPaymentProvider } from '@avn/payments';
import { reference } from '@avn/shared-utils/crypto';
import { Decimal, fromMinorUnits, toMinorUnits } from '@avn/shared-utils/money';
import { deps } from '../../container';
import { audit, SYSTEM, type AuditActor } from '../../lib/audit';
import { AppError, conflict } from '../../lib/errors';
import { ensureWallet, postEntry } from '../../lib/ledger';
import { withTx } from '../../lib/tx';
import { transition } from '../requests/transitions';

export interface InitPaymentInput {
  purpose: PaymentPurpose;
  amount: string;
  currency: string;
  email: string;
  callbackUrl: string;
  userId?: string;
  organisationId?: string;
  requestId?: string;
}

/** Creates a Payment row then initialises the provider transaction. */
export async function initPayment(input: InitPaymentInput) {
  const { prisma, payments, log } = deps();
  const ref = reference('AVN-PAY', 10);
  const payment = await prisma.payment.create({
    data: {
      reference: ref,
      provider: payments.name,
      purpose: input.purpose,
      amount: new Prisma.Decimal(input.amount),
      currency: input.currency,
      userId: input.userId,
      organisationId: input.organisationId,
      requestId: input.requestId,
    },
  });
  try {
    const init = await payments.initialize({
      reference: ref,
      amountMinor: toMinorUnits(input.amount),
      currency: input.currency,
      email: input.email,
      callbackUrl: `${input.callbackUrl}${input.callbackUrl.includes('?') ? '&' : '?'}reference=${ref}`,
      metadata: { purpose: input.purpose, requestId: input.requestId, organisationId: input.organisationId },
    });
    return prisma.payment.update({ where: { id: payment.id }, data: { authorizationUrl: init.authorizationUrl, providerReference: init.providerReference } });
  } catch (err) {
    log.warn({ err: String(err), ref }, 'Payment provider unavailable');
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: 'Payment provider unavailable' } });
    throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'The payment provider is unavailable. Please try again shortly.');
  }
}

/**
 * Confirms a payment by verifying it server-side with the provider. Frontend redirects
 * and webhook bodies are only triggers — the provider's verify response is the truth.
 * Idempotent: the state change and ledger entries apply exactly once.
 */
export async function confirmPayment(ref: string, actor: AuditActor = SYSTEM('payments')) {
  const { prisma, payments } = deps();
  const payment = await prisma.payment.findUnique({ where: { reference: ref } });
  if (!payment) throw new AppError(404, 'NOT_FOUND', 'Payment not found');
  if (payment.status !== 'INITIATED') return payment;
  if (payments instanceof SimulatorPaymentProvider) payments.remember(ref, toMinorUnits(payment.amount.toString()), payment.currency);

  let v;
  try {
    v = await payments.verify(ref);
  } catch {
    throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'Could not reach the payment provider to confirm this payment');
  }
  if (v.status === 'pending') return payment;
  if (v.status !== 'success') {
    return prisma.payment.update({ where: { id: payment.id }, data: { status: v.status === 'abandoned' ? 'ABANDONED' : 'FAILED', failureReason: v.gatewayResponse ?? v.status, verification: v.raw as object } });
  }
  const expectedMinor = toMinorUnits(payment.amount.toString());
  if (v.amountMinor !== expectedMinor || v.currency !== payment.currency) {
    await audit(actor, 'payment.amount_mismatch', 'Payment', payment.id, { expectedMinor, gotMinor: v.amountMinor, currency: v.currency });
    return prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: `Amount mismatch: expected ${payment.amount} got ${fromMinorUnits(v.amountMinor)}`, verification: v.raw as object } });
  }

  return withTx(async (tx, after) => {
    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: 'INITIATED' },
      data: { status: 'SUCCEEDED', paidAt: v.paidAt ?? new Date(), channel: v.channel, verification: v.raw as object },
    });
    if (count === 0) return tx.payment.findUniqueOrThrow({ where: { id: payment.id } }); // concurrent confirmation already applied it
    if (payment.purpose === 'WALLET_TOPUP' && payment.organisationId) {
      const wallet = await ensureWallet(tx, 'ORGANISATION', payment.organisationId, payment.currency);
      await postEntry(tx, { walletId: wallet.id, direction: 'CREDIT', bucket: 'AVAILABLE', category: 'TOPUP', amount: payment.amount.toString(), reference: `topup:${payment.id}`, description: `Wallet top-up ${payment.reference}`, paymentId: payment.id });
    }
    if (payment.purpose === 'INDIVIDUAL_VERIFICATION' && payment.requestId) {
      const r = await tx.verificationRequest.findUniqueOrThrow({ where: { id: payment.requestId } });
      if (r.status === 'CREATED') {
        await transition(tx, after, r.id, 'READY_FOR_ASSIGNMENT', { type: 'SYSTEM' }, { note: `Payment ${payment.reference} confirmed`, data: { paidAt: new Date() } });
      }
    }
    await audit(actor, 'payment.succeeded', 'Payment', payment.id, { amount: payment.amount.toString(), purpose: payment.purpose }, { organisationId: payment.organisationId, db: tx });
    return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
  });
}

/** Webhook entrypoint: signature validated, duplicate events ignored, then re-verified server-side. */
export async function handleWebhook(provider: 'paystack' | 'simulator', rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
  const { prisma, payments, log } = deps();
  if (payments.name !== provider) throw new AppError(404, 'NOT_FOUND', 'Unknown webhook endpoint');
  const signatureOk = payments.verifyWebhookSignature(rawBody, headers);
  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid JSON');
  }
  const event = payments.parseWebhook(body);
  if (!signatureOk) {
    log.warn({ provider, type: event.type }, 'Rejected webhook with invalid signature');
    throw new AppError(401, 'INVALID_SIGNATURE', 'Invalid webhook signature');
  }
  try {
    await prisma.paymentWebhookEvent.create({ data: { provider, eventKey: event.eventKey, type: event.type, payload: body as object, signatureOk } });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return { duplicate: true };
    throw err;
  }
  try {
    if (event.reference && event.type.startsWith('charge.')) await confirmPayment(event.reference);
    if (event.transferReference && event.type.startsWith('transfer.')) {
      const { settlePayout } = await import('../wallets/payouts');
      await settlePayout(event.transferReference, event.type === 'transfer.success' ? 'success' : 'failed');
    }
    await prisma.paymentWebhookEvent.update({ where: { provider_eventKey: { provider, eventKey: event.eventKey } }, data: { processedAt: new Date() } });
  } catch (err) {
    await prisma.paymentWebhookEvent.update({ where: { provider_eventKey: { provider, eventKey: event.eventKey } }, data: { error: String(err).slice(0, 500) } });
    throw err;
  }
  return { received: true };
}

/** Refund a succeeded payment through the provider; reverses wallet credit for top-ups. */
export async function refundPayment(paymentId: string, reason: string, actor: AuditActor) {
  const { prisma, payments } = deps();
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (p.status !== 'SUCCEEDED') throw conflict('Only succeeded payments can be refunded');
  try {
    await payments.refund(p.reference, toMinorUnits(p.amount.toString()));
  } catch {
    throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'Refund could not be submitted to the provider');
  }
  await withTx(async (tx) => {
    await tx.payment.update({ where: { id: p.id }, data: { status: 'REFUNDED', refundedAt: new Date(), refundReason: reason } });
    if (p.purpose === 'WALLET_TOPUP' && p.organisationId) {
      const wallet = await ensureWallet(tx, 'ORGANISATION', p.organisationId, p.currency);
      await postEntry(tx, { walletId: wallet.id, direction: 'DEBIT', bucket: 'AVAILABLE', category: 'ADJUSTMENT', amount: p.amount.toString(), reference: `refund-topup:${p.id}`, description: `Refund of top-up ${p.reference}`, paymentId: p.id });
    }
    await audit(actor, 'payment.refunded', 'Payment', p.id, { reason, amount: p.amount.toString() }, { organisationId: p.organisationId, db: tx });
  });
}

/** Reconciliation: re-verify stale INITIATED payments and compare ledger vs payments. */
export async function reconcilePayments(olderThanMinutes = 15) {
  const { prisma } = deps();
  const stale = await prisma.payment.findMany({ where: { status: 'INITIATED', createdAt: { lt: new Date(Date.now() - olderThanMinutes * 60_000) } }, take: 100 });
  const results: Array<{ reference: string; status: string }> = [];
  for (const p of stale) {
    try {
      const updated = await confirmPayment(p.reference);
      results.push({ reference: p.reference, status: updated.status });
    } catch (err) {
      results.push({ reference: p.reference, status: `ERROR: ${String(err).slice(0, 80)}` });
    }
  }
  const succeeded = await prisma.payment.findMany({ where: { status: 'SUCCEEDED', purpose: 'WALLET_TOPUP', reconciledAt: null }, take: 500 });
  let mismatches = 0;
  for (const p of succeeded) {
    const entry = await prisma.walletTransaction.findFirst({ where: { paymentId: p.id, category: 'TOPUP' } });
    if (entry && new Decimal(entry.amount.toString()).eq(p.amount.toString())) await prisma.payment.update({ where: { id: p.id }, data: { reconciledAt: new Date() } });
    else mismatches++;
  }
  return { reverified: results, ledgerMismatches: mismatches };
}
