import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { client, type Client } from '../../src/testing/fixtures';
import { runScenario } from '../../src/testing/scenario';
import { getApp, prisma, standardWorld } from '../helpers';

let alpha: Client;
let beta: Client;
let alphaRequestId: string;
let alphaReportId: string;

beforeAll(async () => {
  const w = await standardWorld();
  alpha = w.alpha;
  beta = w.beta;
  const s = await runScenario({ app: w.app, prisma, business: alpha, verifierEmail: 'verifier01@avn.local', target: { lat: 6.6031, lng: 3.3502 }, street: 'Tenancy Street', customerReference: 'T-1', applicantName: 'Tenant Test', applicantPhone: '08020001001', seed: 11 });
  alphaRequestId = s.requestId;
  alphaReportId = s.reports![0]!.id;
});

describe('tenant isolation (spec §7.3)', () => {
  it("one institution cannot see another institution's requests or applicants", async () => {
    expect((await beta.get(`/org/requests/${alphaRequestId}`)).status).toBe(404);
    const list = await beta.get('/org/requests?q=Tenant');
    expect(list.body.total).toBe(0);
    const own = await alpha.get('/org/requests?q=Tenant');
    expect(own.body.total).toBe(1);
  });

  it("cannot download another institution's report or evidence files", async () => {
    expect((await beta.get(`/reports/${alphaReportId}/pdf`)).status).toBe(404);
    expect((await beta.post(`/reports/${alphaReportId}/share`)).status).toBe(404);
    const detail = await alpha.get(`/org/requests/${alphaRequestId}`);
    const evidenceUrl: string = detail.body.visit.evidence[0].url;
    const tampered = evidenceUrl.replace(/sig=[a-f0-9]+/, `sig=${'0'.repeat(64)}`);
    expect((await request(getApp()).get(tampered)).status).toBe(403);
    expect((await request(getApp()).get(evidenceUrl)).status).toBe(200);
  });

  it("cannot cancel, dispute or regenerate invitations for another institution's request", async () => {
    expect((await beta.post(`/org/requests/${alphaRequestId}/cancel`, { reason: 'nope' })).status).toBe(404);
    expect((await beta.post(`/org/requests/${alphaRequestId}/disputes`, { reason: 'x', details: 'y' })).status).toBe(404);
    expect((await beta.post(`/org/requests/${alphaRequestId}/invitation`, { send: false })).status).toBe(404);
  });

  it("invoices, statements and API records are isolated", async () => {
    const month = new Date().toISOString().slice(0, 7);
    const a = await alpha.agent.get(`/api/v1/org/billing/statements/${month}`).set('X-AVN-App', 'business');
    expect(a.status).toBe(403); // verification officer lacks billing.read
    const owner = client(getApp(), 'business');
    await owner.login('owner@alpha.test');
    const sa = await owner.get(`/org/billing/statements/${month}`);
    const sb = await beta.get(`/org/billing/statements/${month}`);
    expect(sa.body.verificationsCharged).toBe(1);
    expect(sb.body.verificationsCharged).toBe(0);
    const key = await owner.post('/org/developers/api-keys', { name: 'alpha', scopes: ['requests:read', 'reports:read'] });
    expect((await beta.post(`/org/developers/api-keys/${key.body.id}/rotate`)).status).toBe(404);
    expect((await beta.get('/org/developers/api-keys')).body).toHaveLength(0);
    // Alpha's API key cannot read Beta's data and vice versa.
    const betaOwnerKey = await beta.post('/org/developers/api-keys', { name: 'beta', scopes: ['requests:read'] });
    const asBeta = await request(getApp()).get(`/api/v1/integrations/verifications/${alphaRequestId}`).set('Authorization', `Bearer ${betaOwnerKey.body.key}`);
    expect(asBeta.status).toBe(404);
    const asAlpha = await request(getApp()).get(`/api/v1/integrations/verifications/${alphaRequestId}`).set('Authorization', `Bearer ${key.body.key}`);
    expect(asAlpha.status).toBe(200);
  });
});

describe('institution staff permissions (spec C3)', () => {
  it('auditors are read-only', async () => {
    const auditor = client(getApp(), 'business');
    await auditor.login('auditor@alpha.test');
    expect((await auditor.get(`/org/requests/${alphaRequestId}`)).status).toBe(200);
    expect((await auditor.post('/org/requests', { applicantName: 'A', applicantPhone: '08020001002', customerReference: 'AUD-1' })).status).toBe(403);
    expect((await auditor.post('/org/members', { fullName: 'X', email: 'x@alpha.test', role: 'AUDITOR' })).status).toBe(403);
  });
  it('finance officers can manage billing but not create verifications', async () => {
    const fin = client(getApp(), 'business');
    await fin.login('finance@alpha.test');
    expect((await fin.get('/org/billing')).status).toBe(200);
    expect((await fin.post('/org/requests', { applicantName: 'A', applicantPhone: '08020001003', customerReference: 'FIN-1' })).status).toBe(403);
    expect((await fin.get('/org/audit')).status).toBe(403);
  });
  it('verification officers cannot manage the team, API keys or policies', async () => {
    expect((await alpha.post('/org/members', { fullName: 'X', email: 'y@alpha.test', role: 'AUDITOR' })).status).toBe(403);
    expect((await alpha.get('/org/developers/api-keys')).status).toBe(403);
    expect((await alpha.post('/org/policies', { name: 'P', rules: {} })).status).toBe(403);
  });
  it('evidence links are withheld from staff without evidence.read', async () => {
    const fin = client(getApp(), 'business');
    await fin.login('finance@alpha.test');
    const d = await fin.get(`/org/requests/${alphaRequestId}`);
    expect(d.body.visit.evidence).toEqual([]);
  });
  it('a pending organisation cannot create verification requests', async () => {
    await prisma.organisation.update({ where: { legalName: undefined, id: (await prisma.organisation.findFirstOrThrow({ where: { legalName: 'Beta Bank (Fictional)' } })).id }, data: { status: 'PENDING_REVIEW' } });
    const res = await beta.post('/org/requests', { applicantName: 'A', applicantPhone: '08020001004', customerReference: 'PEND-1' });
    expect(res.status).toBe(403);
    await prisma.organisation.updateMany({ where: { legalName: 'Beta Bank (Fictional)' }, data: { status: 'APPROVED' } });
  });
});
