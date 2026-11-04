import type { AccountType, AdminRole, AppAudience, OrgRole } from '@avn/contracts';

export interface AuthUser {
  id: string;
  accountType: AccountType;
  fullName: string;
  email: string | null;
  phone: string | null;
  adminRole: AdminRole | null;
  isGuest: boolean;
  timezone: string;
  countryCode: string;
}

export interface AuthContext {
  kind: 'anonymous' | 'session' | 'apiKey';
  audience?: AppAudience;
  user?: AuthUser;
  session?: { id: string; scopeRequestId: string | null; mfaVerified: boolean };
  org?: { id: string; role: OrgRole; memberId: string; status: string };
  verifier?: { id: string; status: string };
  apiKey?: { id: string; organisationId: string; scopes: string[]; prefix: string };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth: AuthContext;
      rawBody?: Buffer;
    }
  }
}

export const ANON: AuthContext = { kind: 'anonymous' };
