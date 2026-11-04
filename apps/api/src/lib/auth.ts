import type { NextFunction, Request, Response } from 'express';
import { hashToken, parseApiKey, sessionCookieName, verifyApiKeySecret } from '@avn/auth';
import {
  ADMIN_ROLE_PERMISSIONS,
  APP_AUDIENCES,
  ORG_ROLE_PERMISSIONS,
  type AccountType,
  type AdminPermission,
  type AppAudience,
  type OrgPermission,
} from '@avn/contracts';
import { deps } from '../container';
import { ANON, type AuthContext } from './auth-context';
import { forbidden, unauthenticated } from './errors';
import type { Guard } from './http';

export const AUDIENCE_ACCOUNT: Record<AppAudience, AccountType> = {
  applicant: 'APPLICANT',
  verifier: 'VERIFIER',
  business: 'INSTITUTION',
  admin: 'ADMIN',
};

export function audienceOf(req: Request): AppAudience | undefined {
  const h = String(req.headers['x-avn-app'] ?? '');
  return (APP_AUDIENCES as readonly string[]).includes(h) ? (h as AppAudience) : undefined;
}

function bearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : undefined;
}

/**
 * Resolves the caller on every request: session cookie (per-app cookie name), bearer
 * session token, or institution API key. Never throws — guards decide what is required.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  req.auth = ANON;
  try {
    const { prisma, env } = deps();
    const token = bearer(req);

    if (token && parseApiKey(token)) {
      const parsed = parseApiKey(token)!;
      const cred = await prisma.apiCredential.findUnique({ where: { keyPrefix: parsed.prefix }, include: { organisation: true } });
      if (cred && !cred.revokedAt && cred.organisation.status === 'APPROVED' && verifyApiKeySecret(env.SESSION_SECRET, parsed.body, cred.secretHash)) {
        req.auth = { kind: 'apiKey', apiKey: { id: cred.id, organisationId: cred.organisationId, scopes: cred.scopes, prefix: cred.keyPrefix } };
      }
      return next();
    }

    const audience = audienceOf(req);
    const raw = token ?? (audience ? req.cookies?.[sessionCookieName(audience)] : undefined);
    if (!raw) return next();

    const session = await prisma.userSession.findUnique({
      where: { tokenHash: hashToken(env.SESSION_SECRET, raw) },
      include: { user: { include: { membership: true, verifierProfile: { select: { id: true, status: true } } } } },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) return next();
    const sessionAudience = session.audience as AppAudience;
    // A session minted for one app is never valid in another.
    if (audience && audience !== sessionAudience) return next();
    const u = session.user;
    if (u.deletedAt || u.status === 'SUSPENDED' || u.status === 'DEACTIVATED') return next();

    const ctx: AuthContext = {
      kind: 'session',
      audience: sessionAudience,
      session: { id: session.id, scopeRequestId: session.scopeRequestId, mfaVerified: session.mfaVerified },
      user: {
        id: u.id,
        accountType: u.accountType,
        fullName: u.fullName,
        email: u.email,
        phone: u.phone,
        adminRole: u.adminRole,
        isGuest: u.isGuest,
        timezone: u.timezone,
        countryCode: u.countryCode,
      },
    };
    if (u.membership && u.membership.status === 'ACTIVE') {
      const org = await prisma.organisation.findUnique({ where: { id: u.membership.organisationId }, select: { status: true } });
      ctx.org = { id: u.membership.organisationId, role: u.membership.role, memberId: u.membership.id, status: org?.status ?? 'SUSPENDED' };
    }
    if (u.verifierProfile) ctx.verifier = { id: u.verifierProfile.id, status: u.verifierProfile.status };
    req.auth = ctx;

    // Touch lastSeenAt at most once a minute.
    if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
      void prisma.userSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** CSRF defence for cookie sessions: state-changing requests must carry the custom X-AVN-App header. */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.auth.kind !== 'session' || bearer(req)) return next();
  if (!audienceOf(req)) return next(forbidden('Missing application header'));
  next();
}

// ─── Guards ──────────────────────────────────────────────────────────────────
const guard = (describe: string, check: (auth: AuthContext, req: Request) => void): Guard => ({
  describe,
  handler: (req, _res, next) => {
    try {
      check(req.auth, req);
      next();
    } catch (err) {
      next(err);
    }
  },
});

export const requireUser = (...audiences: AppAudience[]) =>
  guard(`session(${audiences.join('|') || 'any'})`, (auth) => {
    if (auth.kind !== 'session' || !auth.user) throw unauthenticated();
    if (audiences.length && !audiences.includes(auth.audience!)) throw forbidden('This account cannot use this application');
    if (auth.user.accountType !== AUDIENCE_ACCOUNT[auth.audience!]) throw forbidden();
  });

/** Applicant session; guest (invitation) sessions are limited to their single request. */
export const requireApplicant = guard('session(applicant)', (auth) => {
  if (auth.kind !== 'session' || auth.audience !== 'applicant' || auth.user?.accountType !== 'APPLICANT') throw unauthenticated();
});

export const requireVerifier = (opts: { approved?: boolean } = {}) =>
  guard(`session(verifier${opts.approved ? ', approved' : ''})`, (auth) => {
    if (auth.kind !== 'session' || auth.audience !== 'verifier' || !auth.verifier) throw unauthenticated();
    if (opts.approved && auth.verifier.status !== 'APPROVED') throw forbidden('Your verifier account is not approved for assignments');
  });

export const requireOrg = (perm: OrgPermission, opts: { allowPending?: boolean } = {}) =>
  guard(`session(business) perm:${perm}`, (auth) => {
    if (auth.kind !== 'session' || auth.audience !== 'business' || !auth.org) throw unauthenticated();
    if (!opts.allowPending && auth.org.status !== 'APPROVED') throw forbidden('Your organisation has not been approved yet');
    if (!ORG_ROLE_PERMISSIONS[auth.org.role].includes(perm)) throw forbidden();
  });

export const requireAdmin = (perm: AdminPermission) =>
  guard(`session(admin) perm:${perm}`, (auth, req) => {
    if (auth.kind !== 'session' || auth.audience !== 'admin' || !auth.user?.adminRole) throw unauthenticated();
    const allow = deps().env.ADMIN_IP_ALLOWLIST;
    if (allow.length && !allow.includes(req.ip ?? '')) throw forbidden('Admin access is not permitted from this network');
    if (!ADMIN_ROLE_PERMISSIONS[auth.user.adminRole].includes(perm)) throw forbidden();
  });

export const requireApiKey = (scope: string) =>
  guard(`apiKey scope:${scope}`, (auth) => {
    if (auth.kind !== 'apiKey' || !auth.apiKey) throw unauthenticated('A valid API key is required');
    if (!auth.apiKey.scopes.includes(scope)) throw forbidden(`API key lacks scope ${scope}`);
  });

export const requireAnyUser = guard('session(any)', (auth) => {
  if (auth.kind !== 'session' || !auth.user) throw unauthenticated();
});

export function orgCan(auth: AuthContext, perm: OrgPermission): boolean {
  return !!auth.org && ORG_ROLE_PERMISSIONS[auth.org.role].includes(perm);
}
export function adminCan(auth: AuthContext, perm: AdminPermission): boolean {
  return !!auth.user?.adminRole && ADMIN_ROLE_PERMISSIONS[auth.user.adminRole].includes(perm);
}
