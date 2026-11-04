'use client';
import type { ReactNode } from 'react';
import { AppShell, RequireAuth, type NavItem } from '@avn/ui';
import { DutyBar, DutyProvider } from '@/components/duty';

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: 'home', mobile: true },
  { href: '/jobs', label: 'Jobs', icon: 'briefcase', mobile: true },
  { href: '/assignments', label: 'Visits', icon: 'navigation', mobile: true },
  { href: '/earnings', label: 'Earnings', icon: 'wallet', mobile: true },
  { href: '/profile', label: 'Profile', icon: 'user', mobile: true },
  { href: '/notifications', label: 'Notifications', icon: 'bell' },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <DutyProvider>
        <DutyBar />
        <AppShell brand="AVN Agent" subtitle="Field verification" nav={NAV} narrow>
          {children}
        </AppShell>
      </DutyProvider>
    </RequireAuth>
  );
}
