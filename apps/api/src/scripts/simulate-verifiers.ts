/**
 * DEVELOPMENT SIMULATOR — keeps the seeded test verifiers "on duty" by sending location
 * heartbeats through the real API, so the assignment engine can be demonstrated without
 * 16 phones. Each simulated verifier also auto-accepts offers. Never run in production.
 *
 * Usage: pnpm --filter @avn/api simulate:verifiers [count=8] [--accept]
 */
export {};
const { getEnv } = await import('@avn/config');
if (getEnv().APP_ENV === 'production') {
  console.error('Refusing to run the verifier simulator in production.');
  process.exit(1);
}
const base = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const count = Number(process.argv[2] ?? 8);
const autoAccept = process.argv.includes('--accept');
const hubs = [
  { lat: 6.6018, lng: 3.3515 },
  { lat: 6.5095, lng: 3.3711 },
  { lat: 6.5005, lng: 3.3537 },
  { lat: 6.4474, lng: 3.4723 },
];

interface Sim {
  email: string;
  cookie: string;
  sessionId: string;
  pos: { lat: number; lng: number };
}

async function call(path: string, init: RequestInit & { cookie?: string } = {}) {
  const res = await fetch(`${base}/api/v1${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-AVN-App': 'verifier', ...(init.cookie ? { Cookie: init.cookie } : {}) },
  });
  return { res, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

const sims: Sim[] = [];
for (let i = 1; i <= count; i++) {
  const email = `verifier${String(i).padStart(2, '0')}@avn.local`;
  const { res } = await call('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'AvnDemo2026!' }) });
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const hub = hubs[(i - 1) % hubs.length]!;
  const pos = { lat: hub.lat + (Math.random() - 0.5) * 0.01, lng: hub.lng + (Math.random() - 0.5) * 0.01 };
  const av = await call('/verifiers/me/availability', { method: 'POST', cookie, body: JSON.stringify({ available: true, lat: pos.lat, lng: pos.lng, accuracyM: 8 }) });
  if (!av.res.ok) {
    console.warn(`  ${email}: could not go available (${JSON.stringify(av.body)})`);
    continue;
  }
  sims.push({ email, cookie, sessionId: String(av.body.sessionId), pos });
  console.log(`  [SIMULATOR] ${email} on duty near ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`);
}
console.log(`\n${sims.length} simulated verifiers sending heartbeats every 30 s${autoAccept ? ' and auto-accepting offers' : ''}. Ctrl+C to stop.`);

setInterval(async () => {
  for (const s of sims) {
    s.pos = { lat: s.pos.lat + (Math.random() - 0.5) * 0.0004, lng: s.pos.lng + (Math.random() - 0.5) * 0.0004 };
    const hb = await call('/verifiers/me/heartbeat', { method: 'POST', cookie: s.cookie, body: JSON.stringify({ ...s.pos, accuracyM: 8, sessionId: s.sessionId }) });
    if (autoAccept && Number(hb.body.offers) > 0) {
      const offers = await call('/verifiers/me/offers', { cookie: s.cookie });
      const first = (offers.body as unknown as Array<{ id: string }>)[0];
      if (first) {
        const acc = await call(`/offers/${first.id}/accept`, { method: 'POST', cookie: s.cookie, body: JSON.stringify({ idempotencyKey: `sim-${first.id}` }) });
        console.log(`  [SIMULATOR] ${s.email} accept → ${acc.res.status}`);
      }
    }
  }
}, 30_000);

process.on('SIGINT', async () => {
  for (const s of sims) await call('/verifiers/me/availability', { method: 'POST', cookie: s.cookie, body: JSON.stringify({ available: false }) });
  console.log('\nSimulated verifiers went off duty.');
  process.exit(0);
});
