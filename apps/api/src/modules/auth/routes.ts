import { z } from 'zod';
import { generateTotpSecret, hashPassword, issueToken, totpUri, verifyTotp } from '@avn/auth';
import {
  ADMIN_ROLE_PERMISSIONS,
  ORG_ROLE_PERMISSIONS,
  applicantEmailRegisterSchema,
  mfaVerifySchema,
  otpRequestSchema,
  otpVerifySchema,
  passwordLoginSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
} from '@avn/contracts';
import { normalisePhone } from '@avn/shared-utils';
import { decryptField, encryptField } from '@avn/shared-utils/crypto';
import { deps } from '../../container';
import { actorFrom, audit } from '../../lib/audit';
import { AUDIENCE_ACCOUNT, audienceOf, requireAnyUser } from '../../lib/auth';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { routes, uuidParam } from '../../lib/http';
import { sendDirect } from '../../lib/notify';
import { consume } from '../../lib/rate-limit';
import {
  clearSessionCookie,
  createSession,
  issueOtp,
  passwordLogin,
  passwordResetHash,
  revokeAllSessions,
  revokeSession,
  verifyOtp,
} from './service';

export const authRoutes = routes('/auth', 'Authentication');

function requireAudience(req: Parameters<typeof audienceOf>[0]) {
  const a = audienceOf(req);
  if (!a) throw badRequest('X-AVN-App header is required (applicant | verifier | business | admin)');
  return a;
}

function phoneOrThrow(raw: string, country = 'NG') {
  const p = normalisePhone(raw, country);
  if (!p) throw badRequest('Enter a valid phone number');
  return p;
}

authRoutes.post('/otp/request', { summary: 'Send a one-time code to a phone number', body: otpRequestSchema, public: true }, async (ctx, req) => {
  const audience = requireAudience(req);
  if (audience !== 'applicant' && audience !== 'verifier') throw badRequest('Phone OTP is available for applicants and verifiers');
  const phone = phoneOrThrow(ctx.body.phone);
  const result = await issueOtp(phone, `${audience}:${ctx.body.purpose}`, ctx.ip);
  return { sent: true, expiresInSeconds: 600, ...result };
});

authRoutes.post('/otp/verify', { summary: 'Verify a phone OTP and sign in (registers applicants on first use)', body: otpVerifySchema, public: true }, async (ctx, req, res) => {
  const audience = requireAudience(req);
  const phone = phoneOrThrow(ctx.body.phone);
  await verifyOtp(phone, `${audience}:${ctx.body.purpose}`, ctx.body.code);
  const { prisma } = deps();
  const accountType = AUDIENCE_ACCOUNT[audience];
  let user = await prisma.user.findUnique({ where: { accountType_phone: { accountType, phone } } });
  if (!user) {
    if (audience !== 'applicant') throw notFound('Account');
    if (!ctx.body.fullName) throw new AppError(404, 'REGISTRATION_REQUIRED', 'No account for this number yet — tell us your name to register');
    user = await prisma.user.create({
      data: { accountType, phone, fullName: ctx.body.fullName, email: ctx.body.email, phoneVerifiedAt: new Date(), applicantProfile: { create: {} } },
    });
    await audit(actorFrom(ctx), 'auth.registered', 'User', user.id, { method: 'phone_otp' });
  } else if (user.isGuest) {
    // A guest created from an institution invitation becomes a permanent account on first OTP login.
    user = await prisma.user.update({ where: { id: user.id }, data: { isGuest: false, phoneVerifiedAt: new Date(), fullName: ctx.body.fullName ?? user.fullName } });
  } else if (!user.phoneVerifiedAt) {
    user = await prisma.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date() } });
  }
  if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended');
  await createSession(res, user, audience, { ip: ctx.ip, userAgent: ctx.userAgent });
  await audit(actorFrom(ctx), 'auth.login', 'User', user.id, { method: 'phone_otp', audience });
  return { user: { id: user.id, fullName: user.fullName } };
});

authRoutes.post('/register', { summary: 'Register an applicant with email and password', body: applicantEmailRegisterSchema, public: true }, async (ctx, req, res) => {
  if (requireAudience(req) !== 'applicant') throw badRequest('Use the dedicated registration flow for this application');
  await consume('register-ip', ctx.ip, 10, 3600);
  const phone = phoneOrThrow(ctx.body.phone);
  const { prisma } = deps();
  const exists = await prisma.user.findFirst({ where: { accountType: 'APPLICANT', OR: [{ email: ctx.body.email }, { phone }], isGuest: false } });
  if (exists) throw conflict('An account with this email or phone already exists');
  const user = await prisma.user.create({
    data: {
      accountType: 'APPLICANT',
      fullName: ctx.body.fullName,
      email: ctx.body.email,
      phone,
      passwordHash: await hashPassword(ctx.body.password),
      applicantProfile: { create: {} },
    },
  });
  await createSession(res, user, 'applicant', { ip: ctx.ip, userAgent: ctx.userAgent });
  await audit(actorFrom(ctx), 'auth.registered', 'User', user.id, { method: 'email_password' });
  res.status(201);
  return { user: { id: user.id, fullName: user.fullName } };
});

authRoutes.post('/login', { summary: 'Email + password login (with TOTP when MFA is enabled)', body: passwordLoginSchema, public: true }, async (ctx, req, res) => {
  const audience = requireAudience(req);
  await consume('login', `${ctx.ip}:${ctx.body.email}`, 10, 15 * 60);
  const { prisma, env } = deps();
  if (audience === 'admin' && env.ADMIN_IP_ALLOWLIST.length && !env.ADMIN_IP_ALLOWLIST.includes(ctx.ip)) {
    throw new AppError(403, 'IP_RESTRICTED', 'Admin sign-in is not permitted from this network');
  }
  const user = await prisma.user.findUnique({ where: { accountType_email: { accountType: AUDIENCE_ACCOUNT[audience], email: ctx.body.email } } });
  const result = await passwordLogin(user, ctx.body.password, ctx.body.totp, actorFrom(ctx));
  await createSession(res, result.user, audience, { ip: ctx.ip, userAgent: ctx.userAgent, mfaVerified: result.mfaVerified });
  await audit(actorFrom(ctx), 'auth.login', 'User', result.user.id, { method: 'password', audience, mfa: result.mfaVerified });
  return { user: { id: result.user.id, fullName: result.user.fullName }, mfaEnabled: result.user.mfaEnabled };
});

authRoutes.post('/logout', { summary: 'Sign out of this session', public: true }, async (ctx, req, res) => {
  const audience = audienceOf(req);
  if (ctx.auth.session) await revokeSession(ctx.auth.session.id, 'logout');
  if (audience) clearSessionCookie(res, audience);
  return { ok: true };
});

authRoutes.post('/logout-all', { summary: 'Sign out of every session', guard: requireAnyUser }, async (ctx, req, res) => {
  await revokeAllSessions(ctx.auth.user!.id, 'logout_all');
  const audience = audienceOf(req);
  if (audience) clearSessionCookie(res, audience);
  await audit(actorFrom(ctx), 'auth.logout_all', 'User', ctx.auth.user!.id);
  return { ok: true };
});

authRoutes.get('/me', { summary: 'Current user, role and permissions', guard: requireAnyUser }, async (ctx) => {
  const { prisma } = deps();
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: ctx.auth.user!.id },
    include: { membership: { include: { organisation: { select: { id: true, legalName: true, tradingName: true, status: true } } } }, verifierProfile: true },
  });
  return {
    id: u.id,
    accountType: u.accountType,
    fullName: u.fullName,
    email: u.email,
    phone: u.phone,
    isGuest: u.isGuest,
    mfaEnabled: u.mfaEnabled,
    timezone: u.timezone,
    countryCode: u.countryCode,
    notificationPrefs: u.notificationPrefs,
    scopeRequestId: ctx.auth.session?.scopeRequestId ?? null,
    adminRole: u.adminRole,
    adminPermissions: u.adminRole ? ADMIN_ROLE_PERMISSIONS[u.adminRole] : [],
    organisation: u.membership
      ? { ...u.membership.organisation, role: u.membership.role, permissions: ORG_ROLE_PERMISSIONS[u.membership.role] }
      : null,
    verifier: u.verifierProfile ? { id: u.verifierProfile.id, status: u.verifierProfile.status } : null,
  };
});

authRoutes.get('/sessions', { summary: 'Active sessions for the current user', guard: requireAnyUser }, async (ctx) => {
  const sessions = await deps().prisma.userSession.findMany({
    where: { userId: ctx.auth.user!.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, audience: true, ipAddress: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
  });
  return sessions.map((s) => ({ ...s, current: s.id === ctx.auth.session?.id }));
});

authRoutes.delete('/sessions/:id', { summary: 'Revoke one of your sessions', guard: requireAnyUser }, async (ctx) => {
  const id = uuidParam(ctx);
  const s = await deps().prisma.userSession.findFirst({ where: { id, userId: ctx.auth.user!.id } });
  if (!s) throw notFound('Session');
  await revokeSession(id, 'user_revoked');
  return { ok: true };
});

authRoutes.post('/password/forgot', { summary: 'Request a password reset link', body: passwordResetRequestSchema, public: true }, async (ctx, req) => {
  const audience = requireAudience(req);
  await consume('pw-forgot', ctx.ip, 5, 3600);
  const { prisma, env } = deps();
  const user = await prisma.user.findUnique({ where: { accountType_email: { accountType: AUDIENCE_ACCOUNT[audience], email: ctx.body.email } } });
  let devLink: string | undefined;
  if (user) {
    const { raw } = issueToken(env.SESSION_SECRET);
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: passwordResetHash(raw), expiresAt: new Date(Date.now() + 30 * 60_000) } });
    const base = { applicant: env.APPLICANT_APP_URL, verifier: env.VERIFIER_APP_URL, business: env.BUSINESS_APP_URL, admin: env.ADMIN_APP_URL }[audience];
    const link = `${base}/reset-password?token=${raw}`;
    await sendDirect('EMAIL', ctx.body.email, 'auth.password_reset', { link });
    await audit(actorFrom(ctx), 'auth.password_reset_requested', 'User', user.id);
    if (env.OTP_DEV_ECHO && env.APP_ENV !== 'production') devLink = link;
  }
  // Same response whether or not the account exists (no user enumeration).
  return { sent: true, ...(devLink ? { devLink } : {}) };
});

authRoutes.post('/password/reset', { summary: 'Reset password with a reset token', body: passwordResetSchema, public: true }, async (ctx) => {
  const { prisma } = deps();
  const t = await prisma.passwordResetToken.findUnique({ where: { tokenHash: passwordResetHash(ctx.body.token) } });
  if (!t || t.usedAt || t.expiresAt < new Date()) throw new AppError(400, 'TOKEN_INVALID', 'This reset link is invalid or has expired');
  await prisma.$transaction([
    prisma.user.update({ where: { id: t.userId }, data: { passwordHash: await hashPassword(ctx.body.password), failedLoginCount: 0, lockedUntil: null } }),
    prisma.passwordResetToken.update({ where: { id: t.id }, data: { usedAt: new Date() } }),
  ]);
  await revokeAllSessions(t.userId, 'password_reset');
  await audit(actorFrom(ctx), 'auth.password_reset', 'User', t.userId);
  return { ok: true };
});

authRoutes.post('/mfa/setup', { summary: 'Begin TOTP MFA enrolment', guard: requireAnyUser }, async (ctx) => {
  const { prisma, env } = deps();
  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: ctx.auth.user!.id }, data: { mfaSecretEnc: encryptField(secret, env.DATA_ENCRYPTION_KEY), mfaEnabled: false } });
  return { secret, otpauthUrl: totpUri(secret, ctx.auth.user!.email ?? ctx.auth.user!.fullName) };
});

authRoutes.post('/mfa/enable', { summary: 'Confirm TOTP enrolment', guard: requireAnyUser, body: mfaVerifySchema }, async (ctx, req, res) => {
  const { prisma, env } = deps();
  const u = await prisma.user.findUniqueOrThrow({ where: { id: ctx.auth.user!.id } });
  if (!u.mfaSecretEnc || !verifyTotp(decryptField(u.mfaSecretEnc, env.DATA_ENCRYPTION_KEY), ctx.body.code)) throw new AppError(400, 'MFA_INVALID', 'Incorrect code');
  await prisma.user.update({ where: { id: u.id }, data: { mfaEnabled: true } });
  // Rotate: revoke every other session and issue a fresh MFA-verified session.
  await revokeAllSessions(u.id, 'mfa_enabled');
  await createSession(res, u, ctx.auth.audience!, { mfaVerified: true, ip: ctx.ip, userAgent: ctx.userAgent });
  await audit(actorFrom(ctx), 'auth.mfa_enabled', 'User', u.id);
  return { ok: true };
});

authRoutes.post('/mfa/disable', { summary: 'Disable MFA (requires a current code)', guard: requireAnyUser, body: mfaVerifySchema }, async (ctx) => {
  const { prisma, env } = deps();
  const u = await prisma.user.findUniqueOrThrow({ where: { id: ctx.auth.user!.id } });
  if (u.accountType === 'ADMIN') throw badRequest('MFA cannot be disabled for administrators');
  if (!u.mfaSecretEnc || !verifyTotp(decryptField(u.mfaSecretEnc, env.DATA_ENCRYPTION_KEY), ctx.body.code)) throw new AppError(400, 'MFA_INVALID', 'Incorrect code');
  await prisma.user.update({ where: { id: u.id }, data: { mfaEnabled: false, mfaSecretEnc: null } });
  await audit(actorFrom(ctx), 'auth.mfa_disabled', 'User', u.id);
  return { ok: true };
});

authRoutes.put(
  '/preferences',
  { summary: 'Update notification preferences', guard: requireAnyUser, body: z.object({ email: z.boolean(), sms: z.boolean(), push: z.boolean() }) },
  async (ctx) => {
    await deps().prisma.user.update({ where: { id: ctx.auth.user!.id }, data: { notificationPrefs: ctx.body } });
    return { ok: true };
  },
);
