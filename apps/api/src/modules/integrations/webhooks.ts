import type { WebhookEvent } from '@avn/contracts';
import { decryptField, hmacHex } from '@avn/shared-utils/crypto';
import { deps } from '../../container';
import { enqueue, registerJob } from '../../lib/jobs';

const MAX_ATTEMPTS = 6;

/** Records one delivery per matching subscription (outbox) and queues it. */
export async function emitWebhook(organisationId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
  const { prisma } = deps();
  const subs = await prisma.webhookSubscription.findMany({ where: { organisationId, active: true, events: { has: event } } });
  for (const s of subs) {
    const delivery = await prisma.webhookDelivery.create({
      data: { subscriptionId: s.id, event, payload: { event, data, organisationId } as object, nextAttemptAt: new Date() },
    });
    await enqueue('webhooks.deliver', { deliveryId: delivery.id });
  }
}

/** Signature: X-AVN-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")> */
export function signWebhook(secret: string, body: string, timestamp: number): string {
  return `t=${timestamp},v1=${hmacHex(secret, `${timestamp}.${body}`)}`;
}

export async function deliverWebhook(deliveryId: string): Promise<void> {
  const { prisma, env } = deps();
  const d = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { subscription: true } });
  if (!d || d.status === 'SENT' || !d.subscription.active) return;
  const body = JSON.stringify({ id: d.id, createdAt: d.createdAt.toISOString(), ...(d.payload as object) });
  const ts = Math.floor(Date.now() / 1000);
  const secret = decryptField(d.subscription.secretEnc, env.DATA_ENCRYPTION_KEY);
  let status = 0;
  let responseBody = '';
  let error: string | undefined;
  try {
    const res = await fetch(d.subscription.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'AVN-Webhooks/1.0', 'X-AVN-Event': d.event, 'X-AVN-Delivery': d.id, 'X-AVN-Signature': signWebhook(secret, body, ts) },
      body,
      signal: AbortSignal.timeout(10_000),
      redirect: 'manual',
    });
    status = res.status;
    responseBody = (await res.text().catch(() => '')).slice(0, 1000);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Network error';
  }
  const ok = status >= 200 && status < 300;
  const attempts = d.attempts + 1;
  const giveUp = !ok && attempts >= MAX_ATTEMPTS;
  await prisma.webhookDelivery.update({
    where: { id: d.id },
    data: {
      attempts,
      responseStatus: status || null,
      responseBody,
      lastError: error ?? (ok ? null : `HTTP ${status}`),
      status: ok ? 'SENT' : giveUp ? 'FAILED' : 'QUEUED',
      deliveredAt: ok ? new Date() : null,
      nextAttemptAt: ok || giveUp ? null : new Date(Date.now() + Math.min(3600_000, 30_000 * 2 ** attempts)),
    },
  });
}

registerJob<{ deliveryId: string }>('webhooks.deliver', async ({ deliveryId }) => deliverWebhook(deliveryId));
