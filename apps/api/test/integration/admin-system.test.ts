import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AnthropicAiProvider } from '@avn/ai';
import { ValhallaRouter } from '@avn/maps';
import { client, DEMO_PASSWORD, sampleEvidenceJpeg, type Client } from '../../src/testing/fixtures';
import { runScenario } from '../../src/testing/scenario';
import { deps } from '../../src/container';
import { enqueue } from '../../src/lib/jobs';
import { saveSetting, defaultAiConfig } from '../../src/lib/settings';
import { maintenanceTick } from '../../src/jobs/maintenance';
import { getApp, prisma, standardWorld } from '../helpers';

let alpha: Client;
let admin: Client;
beforeAll(async () => {
  ({ alpha } = await standardWorld());
  admin = client(getApp(), 'admin');
  await admin.login('super@avn.local');
});

describe('admin operations (spec D3–D10)', () => {
  it('approves a verifier only after an identity check, then suspends (removing availability)', async () => {
    const pending = await prisma.verifierProfile.findFirstOrThrow({ where: { status: 'MANUAL_REVIEW' } });
    const ok = await admin.post(`/admin/verifiers/${pending.id}/decision`, { decision: 'APPROVE', reason: 'Documents verified' });
    expect(ok.body.status).toBe('APPROVED');
    const v = client(getApp(), 'verifier');
    await v.login('verifier09@avn.local');
    expect((await v.post('/verifiers/me/availability', { available: true, lat: 6.6, lng: 3.35, accuracyM: 5 })).status).toBe(200);
    await admin.post(`/admin/verifiers/${pending.id}/decision`, { decision: 'SUSPEND', reason: 'Audit failure' });
    const avail = await prisma.verifierAvailability.findUniqueOrThrow({ where: { verifierId: pending.id } });
    expect(avail.isAvailable).toBe(false);
    expect((await v.post('/verifiers/me/availability', { available: true, lat: 6.6, lng: 3.35, accuracyM: 5 })).status).toBe(403);
    const audit = await admin.get(`/admin/audit?entityId=${pending.id}`);
    expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['verifier.approve', 'verifier.suspend']));
  });

  it('reassigns an accepted job and investigates fraud signals', async () => {
    const s = await runScenario({ app: getApp(), prisma, business: alpha, verifierEmail: 'verifier01@avn.local', target: { lat: 6.6231, lng: 3.3502 }, street: 'Reassign St', customerReference: 'RE-1', applicantName: 'Re', applicantPhone: '08020005001', seed: 61, stopAfter: 'accepted' });
    const r = await admin.post(`/admin/requests/${s.requestId}/reassign`, { reason: 'Verifier unwell' });
    expect(r.status).toBe(200);
    const a = await prisma.verificationAssignment.findFirstOrThrow({ where: { requestId: s.requestId } });
    expect(a.status).toBe('RELEASED');
    await prisma.fraudSignal.create({ data: { requestId: s.requestId, verifierId: a.verifierId, rule: 'MOCK_LOCATION', severity: 'HIGH', score: 50, explanation: 'test' } });
    const signals = await admin.get('/admin/fraud');
    const sig = signals.body.find((x: { requestId: string }) => x.requestId === s.requestId);
    expect((await admin.post(`/admin/fraud/${sig.id}/resolve`, { resolution: 'CONFIRMED_FRAUD', note: 'Mocked GPS app found' })).status).toBe(200);
    const vp = await prisma.verifierProfile.findUniqueOrThrow({ where: { id: a.verifierId } });
    expect(vp.auditFailCount).toBe(1);
    expect(Number(vp.reliabilityScore)).toBeLessThan(80);
  });

  it('pricing and platform configuration changes are audited and require confirmation', async () => {
    const price = await admin.put('/admin/pricing', { countryCode: 'NG', level: 'BASIC', audience: 'INSTITUTION', price: '3200', verifierReward: '1500', slaHours: 72 });
    expect(price.status).toBe(200);
    const cfg = (await admin.get('/admin/config/platform')).body;
    expect((await admin.put('/admin/config/platform', { ...cfg, arrivalThresholdM: 40, confirmPassword: 'wrong' })).status).toBe(403);
    expect((await admin.put('/admin/config/platform', { ...cfg, arrivalThresholdM: 40, confirmPassword: DEMO_PASSWORD })).status).toBe(200);
    const audit = await admin.get('/admin/audit?action=config.platform_updated');
    expect(audit.body.items[0].metadata.after.arrivalThresholdM).toBe(40);
    expect((await admin.get('/admin/audit?action=pricing.updated')).body.total).toBe(1);
    await admin.put('/admin/config/platform', { ...cfg, confirmPassword: DEMO_PASSWORD });
  });

  it('separates finance permissions from operations', async () => {
    const reviewer = client(getApp(), 'admin');
    await reviewer.login('reviewer@avn.local');
    expect((await reviewer.get('/admin/finance/payouts')).status).toBe(403);
    expect((await reviewer.put('/admin/pricing', { countryCode: 'NG', level: 'BASIC', audience: 'INSTITUTION', price: '1', verifierReward: '1', slaHours: 1 })).status).toBe(403);
    expect((await reviewer.get('/admin/reviews')).status).toBe(200);
  });
});

describe('API integration and signed webhooks (Phase 11 acceptance)', () => {
  let server: Server;
  const received: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.writeHead(200).end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  });
  afterAll(() => server.close());

  it('an external client creates a request, polls status and receives signed completion webhooks', async () => {
    const owner = client(getApp(), 'business');
    await owner.login('owner@alpha.test');
    const key = (await owner.post('/org/developers/api-keys', { name: 'core banking', scopes: ['requests:write', 'requests:read', 'reports:read'] })).body;
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hooks`;
    const hook = (await owner.post('/org/developers/webhooks', { url, events: ['verification.created', 'verification.completed', 'report.issued'] })).body;
    // Secrets are never revealed again after creation.
    expect(JSON.stringify((await owner.get('/org/developers/api-keys')).body)).not.toContain(key.key.split('.')[1]);

    const created = await request(getApp()).post('/api/v1/integrations/verifications').set('Authorization', `Bearer ${key.key}`).set('Idempotency-Key', 'ext-1').send({ applicantName: 'API Person', applicantPhone: '08020006001', customerReference: 'CBS-777' });
    expect(created.status).toBe(201);
    const replay = await request(getApp()).post('/api/v1/integrations/verifications').set('Authorization', `Bearer ${key.key}`).set('Idempotency-Key', 'ext-1').send({ applicantName: 'API Person', applicantPhone: '08020006001', customerReference: 'CBS-777' });
    expect(replay.body.id).toBe(created.body.id);
    const status = await request(getApp()).get(`/api/v1/integrations/verifications/${created.body.reference}`).set('Authorization', `Bearer ${key.key}`);
    expect(status.body.status).toBe('AWAITING_APPLICANT');
    expect((await request(getApp()).get(`/api/v1/integrations/verifications/${created.body.id}`)).status).toBe(401);

    const s = await runScenario({ app: getApp(), prisma, business: owner, verifierEmail: 'verifier02@avn.local', target: { lat: 6.6261, lng: 3.3532 }, street: 'Hook St', customerReference: 'CBS-778', applicantName: 'Hook', applicantPhone: '08020006002', seed: 71 });
    expect(s.outcome).toBe('VERIFIED');
    const completed = received.find((r) => r.body.includes('"verification.completed"') && r.body.includes(s.requestId));
    expect(completed).toBeDefined();
    const sigHeader = String(completed!.headers['x-avn-signature']);
    const [t, v1] = sigHeader.split(',').map((p) => p.split('=')[1]);
    expect(createHmac('sha256', hook.signingSecret).update(`${t}.${completed!.body}`).digest('hex')).toBe(v1);
    expect(received.some((r) => r.body.includes('"report.issued"'))).toBe(true);
    const usage = await owner.get('/org/developers/usage');
    expect(usage.body.recent.length).toBeGreaterThan(0);
  });

  it('bulk CSV: validates, previews, provides an error report and processes valid rows', async () => {
    const owner = client(getApp(), 'business');
    await owner.login('owner@alpha.test');
    const csv = ['applicant_name,applicant_phone,applicant_email,customer_reference,level', 'Good One,08020007001,good@x.com,BULK-1,STANDARD', 'Bad Phone,123,,BULK-2,', 'Bad Email,08020007003,not-an-email,BULK-3,', 'Dup Ref,08020007004,,BULK-1,', ',08020007005,,BULK-5,', 'Good Two,08020007006,,BULK-6,BASIC'].join('\n');
    const up = await owner.upload('/org/bulk', 'file', Buffer.from(csv), 'batch.csv');
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ totalRows: 6, validRows: 2, invalidRows: 4 });
    expect(up.body.errors.map((e: { message: string }) => e.message)).toEqual(expect.arrayContaining(['Invalid phone number', 'Invalid email address', 'Duplicate of row 2', 'Required field missing']));
    const errs = await owner.get(`/org/bulk/${up.body.id}/errors.csv`);
    expect(errs.text.split('\n')[0]).toBe('row,field,message');
    expect((await owner.post(`/org/bulk/${up.body.id}/confirm`)).status).toBe(200);
    const b = await prisma.bulkUpload.findUniqueOrThrow({ where: { id: up.body.id } });
    expect(b).toMatchObject({ status: 'COMPLETED', processedRows: 2 });
    expect((await owner.post(`/org/bulk/${up.body.id}/confirm`)).status).toBe(409);
  });
});

describe('institutional AI assistant (fallback rules, tenant-scoped)', () => {
  it('answers supported questions without free-form SQL', async () => {
    const owner = client(getApp(), 'business');
    await owner.login('owner@alpha.test');
    const a = await owner.post('/org/assistant', { question: 'Show all requests still waiting for agents.' });
    expect(a.body).toMatchObject({ intent: 'WAITING_FOR_AGENTS', interpretedBy: 'rules' });
    const inj = await owner.post('/org/assistant', { question: "'; DROP TABLE \"User\"; --" });
    expect(inj.body.intent).toBe('UNSUPPORTED');
    expect(await prisma.user.count()).toBeGreaterThan(0);
    const officer = client(getApp(), 'business');
    await officer.login('officer@alpha.test');
    expect((await officer.post('/org/assistant', { question: 'monthly spend' })).status).toBe(403);
  });
});

describe('system resilience (spec Part 14 system tests)', () => {
  it('Redis unavailable: enqueue degrades gracefully and the maintenance sweep recovers the work', async () => {
    const d = deps();
    const prev = d.jobsMode;
    d.jobsMode = 'queue'; // redis is null in tests → simulates an outage
    await expect(enqueue('dispatch.run', { requestId: '00000000-0000-0000-0000-000000000000' })).resolves.toBeUndefined();
    const s = await runScenario({ app: getApp(), prisma, business: alpha, verifierEmail: '', target: { lat: 6.63, lng: 3.36 }, street: 'Outage St', customerReference: 'REDIS-1', applicantName: 'Outage', applicantPhone: '08020008001', seed: 81, stopAfter: 'submitted' });
    expect((await prisma.verificationRequest.findUniqueOrThrow({ where: { id: s.requestId } })).lastDispatchAt).toBeNull();
    d.jobsMode = prev;
    await maintenanceTick();
    expect((await prisma.verificationRequest.findUniqueOrThrow({ where: { id: s.requestId } })).lastDispatchAt).not.toBeNull();
  });

  it('AI provider unavailable: evidence and reports still work; AI never decides outcomes', async () => {
    const d = deps();
    const prevAi = d.ai;
    const broken = new AnthropicAiProvider('sk-test-invalid', { timeoutMs: 800, maxRetries: 0 });
    (broken as unknown as { client: { baseURL: string } }).client.baseURL = 'http://127.0.0.1:9';
    d.ai = broken;
    await saveSetting('ai', { ...defaultAiConfig(), enabled: true }, null);
    const s = await runScenario({ app: getApp(), prisma, business: alpha, verifierEmail: 'verifier03@avn.local', target: { lat: 6.6291, lng: 3.3562 }, street: 'AI Down St', customerReference: 'AI-1', applicantName: 'AI Down', applicantPhone: '08020008002', seed: 82 });
    expect(s.outcome).toBe('VERIFIED');
    expect(s.reports![0]!.aiAssisted).toBe(false);
    const failures = await prisma.aiAnalysis.count({ where: { requestId: s.requestId, status: 'FAILED' } });
    expect(failures).toBeGreaterThan(0);
    d.ai = prevAi;
    await saveSetting('ai', { ...defaultAiConfig(), enabled: false }, null);
  });

  it('map routing provider unavailable: dispatch still works with labelled estimates', async () => {
    const d = deps();
    const prev = d.router;
    d.router = new ValhallaRouter('http://127.0.0.1:9', 500);
    const s = await runScenario({ app: getApp(), prisma, business: alpha, verifierEmail: 'verifier04@avn.local', target: { lat: 6.6321, lng: 3.3592 }, street: 'Map Down St', customerReference: 'MAP-1', applicantName: 'Map Down', applicantPhone: '08020008003', seed: 83, stopAfter: 'accepted' });
    const a = await prisma.verificationAssignment.findUniqueOrThrow({ where: { id: s.assignmentId } });
    expect(a.routingSource).toBe('estimate');
    d.router = prev;
    await s.verifier!.post('/verifiers/me/availability', { available: false });
  });

  it('worker restart: a request stuck in PROCESSING is re-evaluated by the sweep', async () => {
    const s = await runScenario({ app: getApp(), prisma, business: alpha, verifierEmail: 'verifier01@avn.local', target: { lat: 6.6351, lng: 3.3622 }, street: 'Restart St', customerReference: 'RESTART-1', applicantName: 'Restart', applicantPhone: '08020008004', seed: 84, stopAfter: 'arrived' });
    for (const [i, category] of ['BUILDING_EXTERIOR', 'BUILDING_ENTRANCE', 'STREET_ENVIRONMENT'].entries()) {
      await s.verifier!.upload(`/assignments/${s.assignmentId}/evidence`, 'file', await sampleEvidenceJpeg(category, 1800 + i), 'e.jpg', { category, lat: 6.6352, lng: 3.3622, accuracyM: 5, capturedAt: new Date().toISOString(), deviceId: 'dev-restart', captureSource: 'CAMERA' });
    }
    const { presentChecklist } = await import('../../src/testing/fixtures');
    // Simulate the worker dying right after submission: put the request back to PROCESSING
    // with no findings, as if evaluation never ran, and let the sweep recover it.
    const submitted = await s.verifier!.post(`/assignments/${s.assignmentId}/submit`, { checklist: presentChecklist, idempotencyKey: 'restart-0001' });
    expect(submitted.body).toMatchObject({ submitted: true });
    await prisma.verificationFinding.deleteMany({ where: { requestId: s.requestId } });
    await prisma.$executeRaw`UPDATE "VerificationRequest" SET status = 'PROCESSING', outcome = NULL, "updatedAt" = now() - interval '5 minutes' WHERE id = ${s.requestId}::uuid`;
    const stats = await maintenanceTick();
    expect(stats.reprocessed).toBeGreaterThanOrEqual(1);
    expect(await prisma.verificationFinding.count({ where: { requestId: s.requestId, supersededAt: null } })).toBe(7);
    expect((await prisma.verificationRequest.findUniqueOrThrow({ where: { id: s.requestId } })).status).not.toBe('PROCESSING');
  });
});
