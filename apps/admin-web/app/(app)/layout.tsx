'use client';
import type { ReactNode } from 'react';
import { Alert, AppShell, RequireAuth, useAuth, type NavItem } from '@avn/ui';

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Overview', icon: 'chart', mobile: true, perm: 'overview.read' },
  { href: '/requests', label: 'Assignments', icon: 'list', mobile: true, perm: 'assignments.manage', section: 'Operations' },
  { href: '/map', label: 'Live map', icon: 'map', perm: 'assignments.manage', section: 'Operations' },
  { href: '/verifiers', label: 'Verifiers', icon: 'users', mobile: true, perm: 'verifiers.review', section: 'Operations' },
  { href: '/organisations', label: 'Institutions', icon: 'briefcase', perm: 'orgs.manage', section: 'Operations' },
  { href: '/users', label: 'Users', icon: 'user', perm: 'users.manage', section: 'Operations' },
  { href: '/reviews', label: 'Manual reviews', icon: 'shield', mobile: true, perm: 'reviews.manage', section: 'Quality' },
  { href: '/fraud', label: 'Fraud signals', icon: 'alert', perm: 'fraud.manage', section: 'Quality' },
  { href: '/evidence', label: 'Evidence browser', icon: 'camera', perm: 'reviews.manage', section: 'Quality' },
  { href: '/disputes', label: 'Disputes', icon: 'inbox', perm: 'disputes.manage', section: 'Quality' },
  { href: '/finance', label: 'Finance', icon: 'wallet', mobile: true, perm: 'finance.read', section: 'Finance' },
  { href: '/config', label: 'Configuration', icon: 'settings', perm: 'overview.read', section: 'Platform' },
  { href: '/geography', label: 'Geography', icon: 'globe', perm: 'geo.manage', section: 'Platform' },
  { href: '/ai', label: 'AI', icon: 'cpu', perm: 'ai.manage', section: 'Platform' },
  { href: '/audit', label: 'Audit log', icon: 'activity', perm: 'audit.read', section: 'Platform' },
  { href: '/security', label: 'Security', icon: 'key', section: 'Platform' },
];

function MfaNudge() {
  const { me } = useAuth();
  if (!me || me.mfaEnabled) return null;
  return <Alert tone="warning" title="Enable two-factor authentication">Administrators should protect their account with an authenticator app. <a href="/security">Set up MFA</a></Alert>;
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell brand="AVN Admin" subtitle="Operations centre" nav={NAV}>
        <div className="stack">
          <MfaNudge />
          {children}
        </div>
      </AppShell>
    </RequireAuth>
  );
}
