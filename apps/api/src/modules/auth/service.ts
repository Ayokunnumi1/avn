import type { Response } from 'express';
import { hashOtp, hashToken, issueToken, SESSION_TTL_MS, sessionCookieName, verifyPassword, verifyTotp } from '@avn/auth';
import type { AppAudience } from '@avn/contracts';
import type { User } from '@avn/database';
import { decryptField, numericCode, safeEqual } from '@avn/shared-utils/crypto';
import { deps } from '../../container';
import { AppError, badRequest, tooMany, unauthenticated } from '../../lib/errors';
import { sendDirect } from '../../lib/notify';
import { consume } from '../../lib/rate-limit';
import { audit, type AuditActor } from '../../lib/audit';

const OTP_TTL_MS = 10 * 60_000;
const MAX_OTP_ATTEMPTS = 5;
const MAX_LOGIN_FAILURES = 5;
const LOCKOUT_MS = 15 * 60_000;

export function setSessionCookie(res: Response, audience: AppAudience, raw: string, expiresAt: Date) {
  res.cookie(sessionCookieName(audience), raw, {
    httpOnly: true,
    sameSite: 'lax',
    secure: deps().env.API_PUBLIC_URL.startsWith('https://') || deps().env.APP_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response, audience: AppAudience) {
  res.clearCookie(sessionCookieName(audience), { path: '/' });
}

/** Issues a new session (session rotation: every login/elevation creates a fresh token). */
export async function createSession(
  res: Response,
  user: Pick<User, 'id'>,
  audience: AppAudience,
  opts: { scopeRequestId?: string; mfaVerified?: boolean; ip?: string; userAgent?: string; guest?: boolean } = {},
) {
  const { prisma, env } = deps();
  const { raw, hash } = issueToken(env.SESSION_SECRET);
  const ttl = opts.guest ? SESSION_TTL_MS.guest! : SESSION_TTL_MS[audience]!;
  const expiresAt = new Date(Date.now() + ttl);
  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      tokenHash: hash,
      audience,
      scopeRequestId: opts.scopeRequestId,
      mfaVerified: opts.mfaVerified ?? false,
      ipAddress: opts.ip,
      userAgent: opts.userAgent,
      expiresAt,
    },
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
  setSessionCookie(res, audience, raw, expiresAt);
  return session;
}

// ─── OTP ─────────────────────────────────────────────────────────────────────
export async function issueOtp(destination: string, purpose: string, ip: string): Promise<{ devCode?: string }> {
  const { prisma, env } = deps();
  await consume('otp-dest', `${destination}:${purpose}`, 5, 15 * 60);
  await consume('otp-ip', ip, 30, 15 * 60);
  const code = numericCode(6);
  await prisma.otpChallenge.updateMany({ where: { destination, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
  await prisma.otpChallenge.create({
    data: { destination, purpose, codeHash: hashOtp(env.SESSION_SECRET, destination, code), expiresAt: new Date(Date.now() + OTP_TTL_MS), ipAddress: ip },
  });
  await sendDirect('SMS', destination, 'auth.otp', { code }, { immediate: true }).catch((err) => {
    deps().log.warn({ err: String(err) }, 'OTP SMS failed');
  });
  // Development simulator only — @avn/config refuses OTP_DEV_ECHO in production.
  return env.OTP_DEV_ECHO && env.APP_ENV !== 'production' ? { devCode: code } : {};
}

export async function verifyOtp(destination: string, purpose: string, code: string): Promise<void> {
  const { prisma, env } = deps();
  const challenge = await prisma.otpChallenge.findFirst({
    where: { destination, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!challenge || challenge.expiresAt < new Date()) throw new AppError(400, 'OTP_EXPIRED', 'The code has expired. Request a new one.');
  if (challenge.attempts >= MAX_OTP_ATTEMPTS) throw tooMany('Too many incorrect attempts. Request a new code.');
  const ok = safeEqual(hashOtp(env.SESSION_SECRET, destination, code), challenge.codeHash);
  if (!ok) {
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    throw new AppError(400, 'OTP_INVALID', 'Incorrect code');
  }
  await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
}

// ─── Password login with lockout + MFA ───────────────────────────────────────
export async function passwordLogin(
  user: User | null,
  password: string,
  totp: string | undefined,
  actor: AuditActor,
): Promise<{ user: User; mfaVerified: boolean }> {
  const { prisma, env } = deps();
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again in 15 minutes.');
  }
  const valid = await verifyPassword(password, user?.passwordHash);
  if (!user || !valid) {
    if (user) {
      const failures = user.failedLoginCount + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: failures, lockedUntil: failures >= MAX_LOGIN_FAILURES ? new Date(Date.now() + LOCKOUT_MS) : null },
      });
      await audit(actor, 'auth.login_failed', 'User', user.id, { failures });
    }
    throw unauthenticated('Incorrect email or password', 'INVALID_CREDENTIALS');
  }
  if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact support.');
  let mfaVerified = false;
  if (user.mfaEnabled && user.mfaSecretEnc) {
    if (!totp) throw new AppError(401, 'MFA_REQUIRED', 'Enter the 6-digit code from your authenticator app');
    if (!verifyTotp(decryptField(user.mfaSecretEnc, env.DATA_ENCRYPTION_KEY), totp)) {
      await audit(actor, 'auth.mfa_failed', 'User', user.id);
      throw new AppError(401, 'MFA_INVALID', 'Incorrect authenticator code');
    }
    mfaVerified = true;
  }
  return { user, mfaVerified };
}

export async function revokeSession(sessionId: string, reason: string) {
  await deps().prisma.userSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
}

export async function revokeAllSessions(userId: string, reason: string, exceptSessionId?: string) {
  await deps().prisma.userSession.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export const passwordResetHash = (raw: string) => hashToken(deps().env.SESSION_SECRET, `reset:${raw}`);

export function assertStrongEnough(password: string) {
  if (password.length < 10) throw badRequest('Password too short');
}
