import type { AdminRole, OrgRole } from './enums';

/** Institution permissions — explicit, enforced server-side on every route (spec C3). */
export const ORG_PERMISSIONS = [
  'org.manage',
  'team.manage',
  'requests.create',
  'requests.read',
  'requests.cancel',
  'reports.read',
  'reports.dispute',
  'evidence.read',
  'bulk.upload',
  'policies.read',
  'policies.manage',
  'billing.read',
  'billing.manage',
  'api.manage',
  'assistant.use',
  'audit.read',
] as const;
export type OrgPermission = (typeof ORG_PERMISSIONS)[number];

export const ORG_ROLE_PERMISSIONS: Record<OrgRole, readonly OrgPermission[]> = {
  OWNER: ORG_PERMISSIONS,
  ADMINISTRATOR: ORG_PERMISSIONS.filter((p) => p !== 'org.manage'),
  SUPERVISOR: ['requests.create', 'requests.read', 'requests.cancel', 'reports.read', 'reports.dispute', 'evidence.read', 'bulk.upload', 'policies.read', 'assistant.use'],
  VERIFICATION_OFFICER: ['requests.create', 'requests.read', 'reports.read', 'evidence.read', 'bulk.upload', 'policies.read'],
  FINANCE_OFFICER: ['requests.read', 'billing.read', 'billing.manage', 'assistant.use'],
  AUDITOR: ['requests.read', 'reports.read', 'evidence.read', 'policies.read', 'billing.read', 'audit.read'],
};

/** Platform-admin permissions. Finance actions are deliberately separate (spec D7). */
export const ADMIN_PERMISSIONS = [
  'overview.read',
  'users.manage',
  'verifiers.review',
  'orgs.manage',
  'assignments.manage',
  'reviews.manage',
  'fraud.manage',
  'disputes.manage',
  'finance.read',
  'finance.manage',
  'payouts.approve',
  'config.manage',
  'geo.manage',
  'ai.manage',
  'audit.read',
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const ADMIN_ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  SUPER_ADMIN: ADMIN_PERMISSIONS,
  OPERATIONS: ['overview.read', 'users.manage', 'verifiers.review', 'orgs.manage', 'assignments.manage', 'geo.manage', 'audit.read'],
  REVIEWER: ['overview.read', 'reviews.manage', 'fraud.manage', 'disputes.manage', 'assignments.manage'],
  FINANCE: ['overview.read', 'finance.read', 'finance.manage', 'payouts.approve', 'audit.read'],
  SUPPORT: ['overview.read', 'audit.read'],
};

export const orgRoleHas = (role: OrgRole, perm: OrgPermission) => ORG_ROLE_PERMISSIONS[role].includes(perm);
export const adminRoleHas = (role: AdminRole, perm: AdminPermission) => ADMIN_ROLE_PERMISSIONS[role].includes(perm);

/** Admin actions requiring explicit re-confirmation (password or TOTP) — spec D1. */
export const PRIVILEGED_ADMIN_ACTIONS = ['payouts.approve', 'finance.manage', 'config.manage', 'ai.manage'] as const;
