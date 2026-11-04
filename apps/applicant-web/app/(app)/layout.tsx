'use client';
import type { ReactNode } from 'react';
import { AppShell, RequireAuth, type NavItem } from '@avn/ui';

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: 'home', mobile: true },
  { href: '/verifications', label: 'Verifications', icon: 'list', mobile: true },
  { href: '/verifications/new', label: 'New', icon: 'plus', mobile: true },
  { href: '/notifications', label: 'Alerts', icon: 'bell', mobile: true },
  { href: '/account', label: 'Account', icon: 'user', mobile: true },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell brand="AVN" subtitle="Address verification" nav={NAV} narrow>
        {children}
      </AppShell>
    </RequireAuth>
  );
}
