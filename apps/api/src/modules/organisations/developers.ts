import { generateApiKey } from '@avn/auth';
import { apiKeyCreateSchema, webhookCreateSchema } from '@avn/contracts';
import { encryptField, randomToken } from '@avn/shared-utils/crypto';
import { deps } from '../../container';
import { actorFrom, audit } from '../../lib/audit';
import { requireOrg } from '../../lib/auth';
import { conflict, notFound } from '../../lib/errors';
import { routes, uuidParam } from '../../lib/http';
import { deliverWebhook } from '../integrations/webhooks';

export const developerRoutes = routes('/org/developers', 'Integrations');

developerRoutes.get('/api-keys', { summary: 'API credentials (secrets are never shown again)', guard: requireOrg('api.manage') }, async (ctx) =>
  (await deps().prisma.apiCredential.findMany({ where: { organisationId: ctx.auth.org!.id }, orderBy: { createdAt: 'desc' } })).map((k) => ({
    id: k.id,
    name: k.name,
    keyPrefix: k.keyPrefix,
    scopes: k.scopes,
    requestCount: k.requestCount,
    lastUsedAt: k.lastUsedAt,
    revokedAt: k.revokedAt,
    createdAt: k.createdAt,
  })),
);

async function createKey(orgId: string, name: string, scopes: string[], createdById: string, rotatedFromId?: string) {
  const { key, prefix, secretHash } = generateApiKey(deps().env.SESSION_SECRET, deps().env.APP_ENV === 'production' ? 'live' : 'test');
  const cred = await deps().prisma.apiCredential.create({ data: { organisationId: orgId, name, keyPrefix: prefix, secretHash, scopes, createdById, rotatedFromId } });
  return { id: cred.id, key, keyPrefix: prefix, note: 'Copy this key now. For security it will never be displayed again.' };
}

developerRoutes.post('/api-keys', { summary: 'Create an API key', guard: requireOrg('api.manage'), body: apiKeyCreateSchema }, async (ctx) => {
  const created = await createKey(ctx.auth.org!.id, ctx.body.name, ctx.body.scopes, ctx.auth.user!.id);
  await audit(actorFrom(ctx), 'api.key_created', 'ApiCredential', created.id, { name: ctx.body.name, scopes: ctx.body.scopes });
  return created;
});

developerRoutes.post('/api-keys/:id/rotate', { summary: 'Rotate a key: issue a replacement and revoke the old one', guard: requireOrg('api.manage') }, async (ctx) => {
  const old = await deps().prisma.apiCredential.findFirst({ where: { id: uuidParam(ctx), organisationId: ctx.auth.org!.id } });
  if (!old) throw notFound('API key');
  if (old.revokedAt) throw conflict('Key already revoked');
  const created = await createKey(old.organisationId, old.name, old.scopes, ctx.auth.user!.id, old.id);
  await deps().prisma.apiCredential.update({ where: { id: old.id }, data: { revokedAt: new Date() } });
  await audit(actorFrom(ctx), 'api.key_rotated', 'ApiCredential', old.id, { replacement: created.id });
  return created;
});

developerRoutes.delete('/api-keys/:id', { summary: 'Revoke an API key', guard: requireOrg('api.manage') }, async (ctx) => {
  const { count } = await deps().prisma.apiCredential.updateMany({ where: { id: uuidParam(ctx), organisationId: ctx.auth.org!.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!count) throw notFound('API key');
  await audit(actorFrom(ctx), 'api.key_revoked', 'ApiCredential', ctx.params.id!);
  return { ok: true };
});

developerRoutes.get('/usage', { summary: 'API usage for the last 30 days', guard: requireOrg('api.manage') }, async (ctx) => {
  const rows = await deps().prisma.$queryRaw<Array<{ day: Date; requests: number; errors: number }>>`
    SELECT date_trunc('day', "createdAt") AS day, count(*)::int AS requests, count(*) FILTER (WHERE "statusCode" >= 400)::int AS errors
    FROM "ApiRequestLog" WHERE "organisationId" = ${ctx.auth.org!.id}::uuid AND "createdAt" > now() - interval '30 days' GROUP BY 1 ORDER BY 1`;
  const recent = await deps().prisma.apiRequestLog.findMany({ where: { organisationId: ctx.auth.org!.id }, orderBy: { createdAt: 'desc' }, take: 25 });
  return { daily: rows, recent, rateLimit: { requestsPerMinute: 120 } };
});

developerRoutes.get('/webhooks', { summary: 'Webhook subscriptions', guard: requireOrg('api.manage') }, async (ctx) =>
  (await deps().prisma.webhookSubscription.findMany({ where: { organisationId: ctx.auth.org!.id }, orderBy: { createdAt: 'desc' } })).map((w) => ({ id: w.id, url: w.url, events: w.events, description: w.description, active: w.active, createdAt: w.createdAt })),
);

developerRoutes.post('/webhooks', { summary: 'Add a webhook endpoint (signing secret shown once)', guard: requireOrg('api.manage'), body: webhookCreateSchema }, async (ctx) => {
  const secret = `whsec_${randomToken(24)}`;
  const w = await deps().prisma.webhookSubscription.create({
    data: { organisationId: ctx.auth.org!.id, url: ctx.body.url, events: ctx.body.events, description: ctx.body.description, secretEnc: encryptField(secret, deps().env.DATA_ENCRYPTION_KEY) },
  });
  await audit(actorFrom(ctx), 'webhook.created', 'WebhookSubscription', w.id, { url: ctx.body.url, events: ctx.body.events });
  return { id: w.id, signingSecret: secret, note: 'Store this secret to verify the X-AVN-Signature header. It will not be shown again.' };
});

developerRoutes.delete('/webhooks/:id', { summary: 'Disable a webhook endpoint', guard: requireOrg('api.manage') }, async (ctx) => {
  const { count } = await deps().prisma.webhookSubscription.updateMany({ where: { id: uuidParam(ctx), organisationId: ctx.auth.org!.id }, data: { active: false } });
  if (!count) throw notFound('Webhook');
  await audit(actorFrom(ctx), 'webhook.disabled', 'WebhookSubscription', ctx.params.id!);
  return { ok: true };
});

developerRoutes.get('/webhooks/:id/deliveries', { summary: 'Webhook delivery history', guard: requireOrg('api.manage') }, async (ctx) => {
  const w = await deps().prisma.webhookSubscription.findFirst({ where: { id: uuidParam(ctx), organisationId: ctx.auth.org!.id } });
  if (!w) throw notFound('Webhook');
  return deps().prisma.webhookDelivery.findMany({ where: { subscriptionId: w.id }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, event: true, status: true, attempts: true, responseStatus: true, lastError: true, deliveredAt: true, nextAttemptAt: true, createdAt: true } });
});

developerRoutes.post('/webhooks/:id/test', { summary: 'Send a signed test event', guard: requireOrg('api.manage') }, async (ctx) => {
  const w = await deps().prisma.webhookSubscription.findFirst({ where: { id: uuidParam(ctx), organisationId: ctx.auth.org!.id, active: true } });
  if (!w) throw notFound('Webhook');
  const d = await deps().prisma.webhookDelivery.create({ data: { subscriptionId: w.id, event: 'webhook.test', payload: { event: 'webhook.test', data: { message: 'Hello from AVN' }, organisationId: w.organisationId } } });
  await deliverWebhook(d.id);
  return deps().prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id }, select: { status: true, responseStatus: true, lastError: true } });
});
