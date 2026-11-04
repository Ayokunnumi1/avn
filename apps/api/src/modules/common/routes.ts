import { z } from 'zod';
import { ADDRESS_PARSE_PROMPT_VERSION, ADDRESS_PARSE_SYSTEM, AddressParseSchema, addressParsePrompt, parseAddressRules } from '@avn/ai';
import { deps } from '../../container';
import { requireAnyUser } from '../../lib/auth';
import { forbidden, notFound } from '../../lib/errors';
import { verifyFileSignature } from '../../lib/files';
import { routes, uuidParam } from '../../lib/http';
import { consume } from '../../lib/rate-limit';
import { runAi } from '../ai/service';

// ─── Notifications ───────────────────────────────────────────────────────────
export const notificationRoutes = routes('/notifications', 'Notifications');

notificationRoutes.get('/', { summary: 'In-app notifications', guard: requireAnyUser, query: z.object({ unread: z.coerce.boolean().optional() }) }, async (ctx) => {
  const { prisma } = deps();
  const where = { userId: ctx.auth.user!.id, ...(ctx.query.unread ? { readAt: null } : {}) };
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.notification.count({ where: { userId: ctx.auth.user!.id, readAt: null } }),
  ]);
  return { unread, items: items.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, data: n.data, readAt: n.readAt, createdAt: n.createdAt })) };
});
notificationRoutes.post('/:id/read', { summary: 'Mark one notification read', guard: requireAnyUser }, async (ctx) => {
  await deps().prisma.notification.updateMany({ where: { id: uuidParam(ctx), userId: ctx.auth.user!.id }, data: { readAt: new Date() } });
  return { ok: true };
});
notificationRoutes.post('/read-all', { summary: 'Mark all notifications read', guard: requireAnyUser }, async (ctx) => {
  await deps().prisma.notification.updateMany({ where: { userId: ctx.auth.user!.id, readAt: null }, data: { readAt: new Date() } });
  return { ok: true };
});
notificationRoutes.get('/push/config', { summary: 'Web push availability and VAPID public key', guard: requireAnyUser }, async () => ({ enabled: deps().push.enabled, publicKey: deps().env.VAPID_PUBLIC_KEY ?? null }));
notificationRoutes.post(
  '/push/subscriptions',
  { summary: 'Register a Web Push subscription', guard: requireAnyUser, body: z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }) },
  async (ctx) => {
    await deps().prisma.pushSubscription.upsert({
      where: { endpoint: ctx.body.endpoint },
      create: { userId: ctx.auth.user!.id, endpoint: ctx.body.endpoint, p256dh: ctx.body.keys.p256dh, auth: ctx.body.keys.auth },
      update: { userId: ctx.auth.user!.id, p256dh: ctx.body.keys.p256dh, auth: ctx.body.keys.auth },
    });
    return { ok: true };
  },
);

// ─── Files (short-lived signed links) ────────────────────────────────────────
export const fileRoutes = routes('/files', 'Files');
fileRoutes.get('/:id', { summary: 'Stream a private file using a short-lived signed link', public: true, query: z.object({ exp: z.string(), sig: z.string().length(64) }) }, async (ctx, _req, res) => {
  const id = uuidParam(ctx);
  if (!verifyFileSignature(id, ctx.query.exp, ctx.query.sig)) throw forbidden('This link has expired');
  const { prisma, storage } = deps();
  const f = await prisma.storedFile.findUnique({ where: { id } });
  if (!f || f.deletedAt) throw notFound('File');
  res.setHeader('Content-Type', f.mimeType);
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', f.mimeType === 'application/pdf' ? 'attachment' : 'inline');
  res.end(await storage.get(f.storageKey));
});

// ─── Geography & address intelligence ────────────────────────────────────────
export const geoRoutes = routes('/geo', 'Location');
geoRoutes.get('/countries', { summary: 'Active countries', public: true }, async () => deps().prisma.country.findMany({ where: { active: true }, orderBy: { name: 'asc' } }));
geoRoutes.get(
  '/areas',
  { summary: 'States / LGAs / cities for address forms', public: true, query: z.object({ countryCode: z.string().length(2).default('NG'), type: z.enum(['STATE', 'LGA', 'CITY']).optional(), parentId: z.string().uuid().optional() }) },
  async (ctx) =>
    deps().prisma.administrativeArea.findMany({
      where: { countryCode: ctx.query.countryCode.toUpperCase(), ...(ctx.query.type ? { type: ctx.query.type } : {}), ...(ctx.query.parentId ? { parentId: ctx.query.parentId } : {}) },
      orderBy: { name: 'asc' },
      select: { id: true, type: true, name: true, parentId: true, serviceActive: true, centerLat: true, centerLng: true },
    }),
);
geoRoutes.get('/search', { summary: 'Address autocomplete via the configured geocoder', guard: requireAnyUser, query: z.object({ q: z.string().trim().min(3).max(200), countryCode: z.string().length(2).default('NG') }) }, async (ctx) => {
  await consume('geocode', ctx.auth.user!.id, 30, 60);
  try {
    return { provider: deps().geocoder.name, results: await deps().geocoder.search(ctx.query.q, ctx.query.countryCode) };
  } catch {
    return { provider: deps().geocoder.name, results: [], unavailable: true };
  }
});
geoRoutes.get('/reverse', { summary: 'Reverse geocode a map pin', guard: requireAnyUser, query: z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }) }, async (ctx) => {
  await consume('geocode', ctx.auth.user!.id, 30, 60);
  try {
    return { provider: deps().geocoder.name, result: await deps().geocoder.reverse({ lat: ctx.query.lat, lng: ctx.query.lng }) };
  } catch {
    return { provider: deps().geocoder.name, result: null, unavailable: true };
  }
});
geoRoutes.post('/parse', { summary: 'AI address intelligence: split free text and identify missing details (suggestions only)', guard: requireAnyUser, body: z.object({ text: z.string().trim().min(5).max(600), countryCode: z.string().length(2).default('NG') }) }, async (ctx) => {
  await consume('address-parse', ctx.auth.user!.id, 20, 60);
  const states = (await deps().prisma.administrativeArea.findMany({ where: { countryCode: ctx.body.countryCode, type: 'STATE' }, select: { name: true } })).map((s) => s.name);
  const ai = await runAi({ feature: 'ADDRESS_PARSE', subjectType: 'User', subjectId: ctx.auth.user!.id, promptVersion: ADDRESS_PARSE_PROMPT_VERSION }, (model) =>
    deps().ai.generateStructured({ model, system: ADDRESS_PARSE_SYSTEM, prompt: addressParsePrompt(ctx.body.text, ctx.body.countryCode), schema: AddressParseSchema, maxTokens: 500 }),
  );
  return { source: ai.data ? 'ai' : 'rules', label: 'Suggestion — please confirm every field', ...(ai.data ?? parseAddressRules(ctx.body.text, states)) };
});
