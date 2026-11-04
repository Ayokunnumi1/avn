'use client';
import type { ReactNode } from 'react';
import { Alert, AppShell, RequireAuth, useAuth, type NavItem } from '@avn/ui';

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'chart', mobile: true },
  { href: '/requests', label: 'Verifications', icon: 'list', mobile: true, perm: 'requests.read' },
  { href: '/requests/new', label: 'New request', icon: 'plus', mobile: true, perm: 'requests.create' },
  { href: '/bulk', label: 'Bulk upload', icon: 'upload', perm: 'bulk.upload' },
  { href: '/assistant', label: 'AI assistant', icon: 'cpu', mobile: true, perm: 'assistant.use' },
  { href: '/policies', label: 'Policies', icon: 'shield', perm: 'policies.read', section: 'Configuration' },
  { href: '/billing', label: 'Billing', icon: 'wallet', perm: 'billing.read', section: 'Configuration' },
  { href: '/team', label: 'Team', icon: 'users', section: 'Configuration' },
  { href: '/developers', label: 'API & webhooks', icon: 'key', perm: 'api.manage', section: 'Configuration' },
  { href: '/audit', label: 'Audit trail', icon: 'activity', perm: 'audit.read', section: 'Configuration' },
  { href: '/security', label: 'Security', icon: 'settings', mobile: true, section: 'Configuration' },
];

function PendingBanner() {
  const { me } = useAuth();
  if (!me?.organisation || me.organisation.status === 'APPROVED') return null;
  return (
    <Alert tone="warning" title={`Organisation ${me.organisation.status.replace('_', ' ').toLowerCase()}`}>
      The AVN platform team must approve your organisation before you can create verification requests. You can still configure your team and policies.
    </Alert>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell brand="AVN Business" subtitle="Institution console" nav={NAV}>
        <div className="stack">
          <PendingBanner />
          {children}
        </div>
      </AppShell>
    </RequireAuth>
  );
}
