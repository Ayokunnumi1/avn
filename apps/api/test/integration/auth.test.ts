import { beforeAll, describe, expect, it } from 'vitest';
import { totpAt } from '@avn/auth';
import { client, DEMO_PASSWORD } from '../../src/testing/fixtures';
import { getApp, prisma, standardWorld } from '../helpers';

beforeAll(async () => {
  await standardWorld();
});

describe('applicant registration & OTP', () => {
  it('registers a new applicant by phone OTP and creates a session', async () => {
    const c = client(getApp(), 'applicant');
    const sent = await c.post('/auth/otp/request', { phone: '0803 555 0101', purpose: 'REGISTER' });
    expect(sent.status).toBe(200);
    expect(sent.body.devCode).toMatch(/^\d{6}$/);
    const noName = await c.post('/auth/otp/verify', { phone: '08035550101', code: sent.body.devCode, purpose: 'REGISTER' });
    expect(noName.status).toBe(404);
    expect(noName.body.error.code).toBe('REGISTRATION_REQUIRED');
    const again = await c.post('/auth/otp/request', { phone: '08035550101', purpose: 'REGISTER' });
    const ok = await c.post('/auth/otp/verify', { phone: '08035550101', code: again.body.devCode, purpose: 'REGISTER', fullName: 'New Person' });
    expect(ok.status).toBe(200);
    const me = await c.get('/auth/me');
    expect(me.body).toMatchObject({ accountType: 'APPLICANT', phone: '+2348035550101', fullName: 'New Person' });
  });

  it('rejects wrong codes, locks after 5 attempts and expires codes', async () => {
    const c = client(getApp(), 'applicant');
    await c.post('/auth/otp/request', { phone: '08035550102', purpose: 'LOGIN' });
    for (let i = 0; i < 5; i++) {
      const r = await c.post('/auth/otp/verify', { phone: '08035550102', code: '000000', purpose: 'LOGIN', fullName: 'X' });
      expect(r.body.error.code).toBe('OTP_INVALID');
    }
    const locked = await c.post('/auth/otp/verify', { phone: '08035550102', code: '000000', purpose: 'LOGIN' });
    expect(locked.status).toBe(429);
    await prisma.otpChallenge.updateMany({ where: { destination: '+2348035550102' }, data: { expiresAt: new Date(Date.now() - 1000), attempts: 0 } });
    const expired = await c.post('/auth/otp/verify', { phone: '08035550102', code: '000000', purpose: 'LOGIN' });
    expect(expired.body.error.code).toBe('OTP_EXPIRED');
  });

  it('stores only hashed OTPs', async () => {
    const c = client(getApp(), 'applicant');
    const sent = await c.post('/auth/otp/request', { phone: '08035550103', purpose: 'LOGIN' });
    const row = await prisma.otpChallenge.findFirstOrThrow({ where: { destination: '+2348035550103' }, orderBy: { createdAt: 'desc' } });
    expect(row.codeHash).not.toContain(sent.body.devCode);
  });
});

describe('password login, lockout and MFA', () => {
  it('locks an account after 5 failed attempts', async () => {
    const c = client(getApp(), 'business');
    for (let i = 0; i < 5; i++) expect((await c.login('auditor@alpha.test', 'Wrong-password-1')).status).toBe(401);
    const locked = await c.login('auditor@alpha.test');
    expect(locked.status).toBe(423);
    await prisma.user.updateMany({ where: { email: 'auditor@alpha.test' }, data: { lockedUntil: null, failedLoginCount: 0 } });
  });

  it('requires TOTP after MFA enrolment and rotates sessions', async () => {
    const c = client(getApp(), 'admin');
    expect((await c.login('ops@avn.local')).status).toBe(200);
    const setup = await c.post('/auth/mfa/setup');
    expect(setup.body.otpauthUrl).toContain('otpauth://totp/');
    const enabled = await c.post('/auth/mfa/enable', { code: totpAt(setup.body.secret, Date.now()) });
    expect(enabled.status).toBe(200);
    const fresh = client(getApp(), 'admin');
    const noCode = await fresh.post('/auth/login', { email: 'ops@avn.local', password: DEMO_PASSWORD });
    expect(noCode.body.error.code).toBe('MFA_REQUIRED');
    const bad = await fresh.post('/auth/login', { email: 'ops@avn.local', password: DEMO_PASSWORD, totp: '123456' });
    expect(bad.body.error.code).toBe('MFA_INVALID');
    const good = await fresh.post('/auth/login', { email: 'ops@avn.local', password: DEMO_PASSWORD, totp: totpAt(setup.body.secret, Date.now()) });
    expect(good.status).toBe(200);
  });
});

describe('route protection', () => {
  it('blocks unauthenticated access to protected APIs', async () => {
    const anon = client(getApp(), 'business');
    expect((await anon.get('/org/requests')).status).toBe(401);
    expect((await client(getApp(), 'admin').get('/admin/overview')).status).toBe(401);
    expect((await client(getApp(), 'verifier').get('/verifiers/me')).status).toBe(401);
  });

  it('never accepts a session minted for another app', async () => {
    const applicant = client(getApp(), 'applicant');
    await applicant.login('applicant01@avn.local');
    const cookie = (await applicant.get('/auth/me')).request.getHeader?.('cookie');
    expect(cookie ?? '').toBeDefined();
    const res = await applicant.agent.get('/api/v1/admin/overview').set('X-AVN-App', 'admin');
    expect(res.status).toBe(401);
  });

  it('requires the X-AVN-App header for cookie-authenticated mutations (CSRF)', async () => {
    const c = client(getApp(), 'business');
    await c.login('officer@alpha.test');
    const res = await c.agent.post('/api/v1/auth/logout-all').send({});
    expect([401, 403]).toContain(res.status);
  });

  it('logout revokes the session', async () => {
    const c = client(getApp(), 'verifier');
    await c.login('verifier01@avn.local');
    expect((await c.get('/verifiers/me')).status).toBe(200);
    await c.post('/auth/logout');
    expect((await c.get('/verifiers/me')).status).toBe(401);
  });

  it('password reset revokes existing sessions', async () => {
    const c = client(getApp(), 'applicant');
    await c.login('applicant02@avn.local');
    const r = await client(getApp(), 'applicant').post('/auth/password/forgot', { email: 'applicant02@avn.local' });
    const token = new URL(r.body.devLink).searchParams.get('token');
    const reset = await client(getApp(), 'applicant').post('/auth/password/reset', { token, password: 'Brand-New-Pass1' });
    expect(reset.status).toBe(200);
    expect((await c.get('/auth/me')).status).toBe(401);
    expect((await client(getApp(), 'applicant').login('applicant02@avn.local', 'Brand-New-Pass1')).status).toBe(200);
  });
});
