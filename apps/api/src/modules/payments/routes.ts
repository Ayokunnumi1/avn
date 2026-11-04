import { z } from 'zod';
import { SimulatorPaymentProvider } from '@avn/payments';
import { formatMoney } from '@avn/shared-utils/money';
import { deps } from '../../container';
import { requireAnyUser } from '../../lib/auth';
import { AppError, forbidden, notFound } from '../../lib/errors';
import { routes } from '../../lib/http';
import { confirmPayment, handleWebhook } from './service';

export const paymentRoutes = routes('/payments', 'Payments');

paymentRoutes.post('/webhooks/:provider', { summary: 'Payment provider webhook (signature-validated, duplicate-safe)', public: true }, async (ctx, req) => {
  const provider = z.enum(['paystack', 'simulator']).parse(ctx.params.provider);
  if (!req.rawBody) throw new AppError(400, 'VALIDATION_ERROR', 'Missing body');
  return handleWebhook(provider, req.rawBody, req.headers);
});

paymentRoutes.get('/:reference/status', { summary: 'Server-side payment confirmation (call after the checkout redirect)', guard: requireAnyUser }, async (ctx) => {
  const ref = z.string().min(8).max(40).parse(ctx.params.reference);
  const p = await deps().prisma.payment.findUnique({ where: { reference: ref } });
  if (!p) throw notFound('Payment');
  const own = p.userId === ctx.auth.user!.id || (p.organisationId && p.organisationId === ctx.auth.org?.id);
  if (!own) throw forbidden();
  const updated = await confirmPayment(ref);
  return { reference: updated.reference, status: updated.status, amount: updated.amount.toFixed(2), currency: updated.currency, purpose: updated.purpose, requestId: updated.requestId, paidAt: updated.paidAt, failureReason: updated.failureReason };
});

// ─── DEVELOPMENT SIMULATOR checkout (never active in production) ─────────────
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

paymentRoutes.get('/simulator/checkout/:reference', { summary: 'DEV ONLY: simulated hosted checkout page', public: true }, async (ctx, _req, res) => {
  const { payments, prisma } = deps();
  if (!(payments instanceof SimulatorPaymentProvider)) throw notFound('Endpoint');
  const p = await prisma.payment.findUnique({ where: { reference: ctx.params.reference } });
  if (!p) throw notFound('Payment');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
  res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Simulated checkout</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f6f8;margin:0;display:grid;place-items:center;min-height:100vh;color:#0f1b2d}
.card{background:#fff;border-radius:12px;padding:28px;max-width:380px;width:calc(100% - 32px);box-shadow:0 4px 24px rgba(15,27,45,.08)}
.badge{display:inline-block;background:#fff3cd;color:#7a5b00;border-radius:6px;padding:4px 8px;font-size:12px;font-weight:600}
h1{font-size:20px;margin:14px 0 4px}.amt{font-size:32px;font-weight:700;margin:8px 0 20px}
button{width:100%;padding:14px;border:0;border-radius:8px;font-size:16px;font-weight:600;margin-top:10px;cursor:pointer}
.pay{background:#0f766e;color:#fff}.fail{background:#eef1f4;color:#0f1b2d}</style></head>
<body><div class="card"><span class="badge">DEVELOPMENT PAYMENT SIMULATOR — no real money moves</span>
<h1>AVN payment</h1><div>Reference ${esc(p.reference)}</div><div class="amt">${esc(formatMoney(p.amount.toString(), p.currency))}</div>
<form method="post"><input type="hidden" name="outcome" value="success"><button class="pay">Simulate successful payment</button></form>
<form method="post"><input type="hidden" name="outcome" value="failed"><button class="fail">Simulate failed payment</button></form>
</div></body></html>`);
});

paymentRoutes.post(
  '/simulator/checkout/:reference',
  { summary: 'DEV ONLY: complete a simulated checkout (emits a signed webhook)', public: true, body: z.object({ outcome: z.enum(['success', 'failed']) }) },
  async (ctx, _req, res) => {
    const { payments, prisma, env } = deps();
    if (!(payments instanceof SimulatorPaymentProvider)) throw notFound('Endpoint');
    const p = await prisma.payment.findUnique({ where: { reference: ctx.params.reference } });
    if (!p) throw notFound('Payment');
    const { body, signature } = payments.complete(p.reference, ctx.body.outcome === 'success');
    // Exercise the exact production path: signed webhook → signature check → server-side verify.
    await handleWebhook('simulator', Buffer.from(body), { 'x-avn-simulator-signature': signature });
    const callback = p.purpose === 'WALLET_TOPUP' ? `${env.BUSINESS_APP_URL}/billing?reference=${p.reference}` : `${env.APPLICANT_APP_URL}/payments/callback?reference=${p.reference}`;
    res.redirect(303, callback);
  },
);
