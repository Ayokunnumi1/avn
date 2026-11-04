import { DEFAULT_TEMPLATES, DeliveryError, renderTemplate } from '@avn/notifications';
import type { Db, NotificationChannel } from '@avn/database';
import { maskPhone } from '@avn/shared-utils';
import { deps } from '../container';
import { enqueue, registerJob } from './jobs';

type Vars = Record<string, string | number | undefined>;

async function template(key: string, channel: NotificationChannel) {
  const override = await deps().prisma.notificationTemplate.findUnique({ where: { key_channel: { key, channel } } });
  const def = DEFAULT_TEMPLATES[key] ?? { title: key, body: key };
  return {
    title: override?.subject ?? def.emailSubject ?? def.title,
    body: override?.body ?? (channel === 'SMS' ? (def.sms ?? def.body) : def.body),
  };
}

/**
 * Central notification service: writes the in-app notification and one delivery row per
 * external channel (respecting user preferences), then queues each delivery.
 */
export async function notifyUser(
  userId: string,
  key: string,
  vars: Vars,
  opts: { channels?: NotificationChannel[]; data?: Record<string, unknown>; db?: Db } = {},
): Promise<void> {
  const db = opts.db ?? deps().prisma;
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return;
  const t = await template(key, 'IN_APP');
  const notification = await db.notification.create({
    data: { userId, type: key, title: renderTemplate(t.title, vars), body: renderTemplate(t.body, vars), data: (opts.data ?? undefined) as object | undefined },
  });
  const prefs = (user.notificationPrefs ?? {}) as { email?: boolean; sms?: boolean; push?: boolean };
  const channels = opts.channels ?? ['PUSH'];
  const deliveries: string[] = [];
  for (const channel of channels) {
    let destination: string | null = null;
    if (channel === 'SMS' && user.phone && prefs.sms !== false) destination = user.phone;
    if (channel === 'EMAIL' && user.email && prefs.email !== false) destination = user.email;
    if (channel === 'PUSH' && prefs.push !== false) {
      const sub = await db.pushSubscription.count({ where: { userId } });
      if (sub > 0 && deps().push.enabled) destination = 'push';
    }
    if (!destination) continue;
    const d = await db.notificationDelivery.create({
      data: { notificationId: notification.id, userId, channel, destination, template: key, payload: vars as object },
    });
    deliveries.push(d.id);
  }
  for (const id of deliveries) await enqueue('notifications.deliver', { deliveryId: id });
}

/** Sends to a raw destination (e.g. OTP or invitation to someone without an account). */
export async function sendDirect(
  channel: 'SMS' | 'EMAIL',
  destination: string,
  key: string,
  vars: Vars,
  opts: { immediate?: boolean; userId?: string } = {},
): Promise<void> {
  const d = await deps().prisma.notificationDelivery.create({
    data: { channel, destination, template: key, payload: vars as object, userId: opts.userId },
  });
  if (opts.immediate) await deliver(d.id);
  else await enqueue('notifications.deliver', { deliveryId: d.id });
}

export async function deliver(deliveryId: string): Promise<void> {
  const { prisma, sms, email, push, log } = deps();
  const d = await prisma.notificationDelivery.findUnique({ where: { id: deliveryId } });
  if (!d || d.status === 'SENT' || d.status === 'SKIPPED') return;
  const vars = (d.payload ?? {}) as Vars;
  const t = await template(d.template, d.channel);
  const title = renderTemplate(t.title, vars);
  const body = renderTemplate(t.body, vars);
  try {
    let providerMessageId: string | undefined;
    if (d.channel === 'SMS') providerMessageId = (await sms.send(d.destination, body)).providerMessageId;
    else if (d.channel === 'EMAIL') providerMessageId = (await email.send({ to: d.destination, subject: title, text: body })).providerMessageId;
    else if (d.channel === 'PUSH' && d.userId) {
      const subs = await prisma.pushSubscription.findMany({ where: { userId: d.userId } });
      for (const s of subs) {
        try {
          await push.send(s, { title, body, url: '/notifications' });
        } catch (err) {
          if (err instanceof DeliveryError && !err.retryable) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
        }
      }
    }
    await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 }, providerMessageId } });
  } catch (err) {
    const retryable = err instanceof DeliveryError ? err.retryable : true;
    const attempts = d.attempts + 1;
    await prisma.notificationDelivery.update({
      where: { id: d.id },
      data: { status: retryable && attempts < 5 ? 'QUEUED' : 'FAILED', attempts, lastError: err instanceof Error ? err.message.slice(0, 500) : 'error' },
    });
    log.warn({ deliveryId, channel: d.channel, to: d.channel === 'SMS' ? maskPhone(d.destination) : undefined, err: String(err) }, 'Notification delivery failed');
    if (retryable && attempts < 5) throw err; // let BullMQ apply backoff
  }
}

registerJob<{ deliveryId: string }>('notifications.deliver', async ({ deliveryId }) => deliver(deliveryId));
