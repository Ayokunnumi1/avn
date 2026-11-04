import { z } from 'zod';
import { topUpSchema } from '@avn/contracts';
import { Prisma } from '@avn/database';
import { Decimal } from '@avn/shared-utils/money';
import { deps } from '../../container';
import { actorFrom, audit } from '../../lib/audit';
import { requireOrg } from '../../lib/auth';
import { routes } from '../../lib/http';
import { ensureWallet } from '../../lib/ledger';
import { withTx } from '../../lib/tx';
import { initPayment } from '../payments/service';

export const billingRoutes = routes('/org/billing', 'Billing');
const month = z.string().regex(/^\d{4}-\d{2}$/);

billingRoutes.get('/', { summary: 'Wallet, credit and pricing overview', guard: requireOrg('billing.read') }, async (ctx) => {
  const { prisma } = deps();
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: ctx.auth.org!.id } });
  const wallet = await withTx((tx) => ensureWallet(tx, 'ORGANISATION', org.id));
  const pricing = await prisma.pricingPlan.findMany({ where: { countryCode: org.countryCode, audience: 'INSTITUTION', active: true }, orderBy: { price: 'asc' } });
  return {
    available: wallet.availableBalance.toFixed(2),
    currency: wallet.currency,
    postpaidEnabled: org.postpaidEnabled,
    creditLimit: org.creditLimit.toFixed(2),
    pricing: pricing.map((p) => ({ level: p.level, price: p.price.toFixed(2), bulkThreshold: p.bulkThreshold, bulkPrice: p.bulkPrice?.toFixed(2) ?? null, slaHours: p.slaHours })),
  };
});

billingRoutes.get('/transactions', { summary: 'Ledger transaction history', guard: requireOrg('billing.read') }, async (ctx) => {
  const wallet = await withTx((tx) => ensureWallet(tx, 'ORGANISATION', ctx.auth.org!.id));
  const tx = await deps().prisma.walletTransaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: 'desc' }, take: 200 });
  return tx.map((t) => ({ id: t.id, direction: t.direction, category: t.category, amount: t.amount.toFixed(2), balanceAfter: t.balanceAfter.toFixed(2), description: t.description, requestId: t.requestId, createdAt: t.createdAt }));
});

billingRoutes.post('/topup', { summary: 'Top up the prepaid wallet via the payment provider', guard: requireOrg('billing.manage'), body: topUpSchema }, async (ctx) => {
  const org = await deps().prisma.organisation.findUniqueOrThrow({ where: { id: ctx.auth.org!.id } });
  const p = await initPayment({
    purpose: 'WALLET_TOPUP',
    amount: new Decimal(ctx.body.amount).toFixed(2),
    currency: 'NGN',
    email: ctx.auth.user!.email ?? org.contactEmail,
    organisationId: org.id,
    userId: ctx.auth.user!.id,
    callbackUrl: `${deps().env.BUSINESS_APP_URL}/billing`,
  });
  await audit(actorFrom(ctx), 'billing.topup_initiated', 'Payment', p.id, { amount: ctx.body.amount });
  return { reference: p.reference, authorizationUrl: p.authorizationUrl };
});

/** Monthly statement computed from the immutable ledger (usage-based billing). */
async function statement(orgId: string, m: string) {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  const start = new Date(Date.UTC(y, mo - 1, 1));
  const end = new Date(Date.UTC(y, mo, 1));
  const wallet = await withTx((tx) => ensureWallet(tx, 'ORGANISATION', orgId));
  const entries = await deps().prisma.walletTransaction.findMany({ where: { walletId: wallet.id, createdAt: { gte: start, lt: end } }, orderBy: { createdAt: 'asc' } });
  const sum = (cat: string, dir: 'CREDIT' | 'DEBIT') => entries.filter((e) => e.category === cat && e.direction === dir).reduce((s, e) => s.plus(e.amount.toString()), new Decimal(0));
  const charges = sum('VERIFICATION_CHARGE', 'DEBIT');
  const refunds = sum('VERIFICATION_REFUND', 'CREDIT');
  const topups = sum('TOPUP', 'CREDIT');
  return {
    period: m,
    periodStart: start,
    periodEnd: end,
    currency: wallet.currency,
    verificationsCharged: entries.filter((e) => e.category === 'VERIFICATION_CHARGE').length,
    charges: charges.toFixed(2),
    refunds: refunds.toFixed(2),
    netUsage: charges.minus(refunds).toFixed(2),
    topups: topups.toFixed(2),
    openingBalance: entries[0] ? new Decimal(entries[0].balanceAfter.toString()).plus(entries[0].direction === 'DEBIT' ? entries[0].amount.toString() : new Decimal(entries[0].amount.toString()).negated()).toFixed(2) : wallet.availableBalance.toFixed(2),
    closingBalance: entries.length ? entries[entries.length - 1]!.balanceAfter.toFixed(2) : wallet.availableBalance.toFixed(2),
    lines: entries.map((e) => ({ date: e.createdAt, description: e.description, direction: e.direction, amount: e.amount.toFixed(2), balanceAfter: e.balanceAfter.toFixed(2) })),
  };
}

billingRoutes.get('/statements/:month', { summary: 'Monthly statement', guard: requireOrg('billing.read') }, async (ctx) => statement(ctx.auth.org!.id, month.parse(ctx.params.month)));

billingRoutes.post('/invoices/:month', { summary: 'Generate (or fetch) the invoice for a month', guard: requireOrg('billing.manage') }, async (ctx) => {
  const m = month.parse(ctx.params.month);
  const s = await statement(ctx.auth.org!.id, m);
  const existing = await deps().prisma.invoice.findUnique({ where: { organisationId_periodStart: { organisationId: ctx.auth.org!.id, periodStart: s.periodStart } } });
  if (existing) return existing;
  const inv = await deps().prisma.invoice.create({
    data: {
      organisationId: ctx.auth.org!.id,
      number: `INV-${m.replace('-', '')}-${ctx.auth.org!.id.slice(0, 6).toUpperCase()}`,
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      currency: s.currency,
      total: new Prisma.Decimal(s.netUsage),
      lineItems: [{ description: `Address verifications (${s.verificationsCharged})`, amount: s.charges }, { description: 'Refunds for cancelled verifications', amount: `-${s.refunds}` }] as object,
    },
  });
  await audit(actorFrom(ctx), 'billing.invoice_generated', 'Invoice', inv.id, { month: m, total: s.netUsage });
  return inv;
});

billingRoutes.get('/invoices', { summary: 'Issued invoices', guard: requireOrg('billing.read') }, async (ctx) => deps().prisma.invoice.findMany({ where: { organisationId: ctx.auth.org!.id }, orderBy: { periodStart: 'desc' } }));

billingRoutes.get('/payments', { summary: 'Top-up payments', guard: requireOrg('billing.read') }, async (ctx) =>
  (await deps().prisma.payment.findMany({ where: { organisationId: ctx.auth.org!.id }, orderBy: { createdAt: 'desc' }, take: 50 })).map((p) => ({ reference: p.reference, amount: p.amount.toFixed(2), status: p.status, provider: p.provider, createdAt: p.createdAt, paidAt: p.paidAt })),
);
