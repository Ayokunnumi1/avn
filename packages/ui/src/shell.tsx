'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from './auth';
import { Icon } from './icons';

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Include in the mobile bottom navigation (max ~5). */
  mobile?: boolean;
  /** Permission required to show the item (server still enforces). */
  perm?: string;
  section?: string;
}

/**
 * Responsive application shell: sidebar on desktop, icon rail with expandable drawer on
 * tablet, compact header + bottom navigation on mobile.
 */
export function AppShell({ brand, subtitle, nav, children, title, narrow, headerRight }: { brand: string; subtitle: string; nav: NavItem[]; children: ReactNode; title?: string; narrow?: boolean; headerRight?: ReactNode }) {
  const path = usePathname();
  const { me, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const visible = nav.filter((n) => !n.perm || can(n.perm));
  const active = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`));
  let lastSection: string | undefined;
  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className={`sidebar ${open ? 'expanded' : ''}`} aria-label="Primary">
        <Link href="/" className="brand" style={{ textDecoration: 'none' }}>
          <span className="brand-mark" aria-hidden>
            AVN
          </span>
          <span className="brand-name">
            {brand}
            <small>{subtitle}</small>
          </span>
        </Link>
        <nav className="stack-sm" style={{ gap: 2 }}>
          {visible.map((n) => {
            const header = n.section && n.section !== lastSection ? n.section : null;
            lastSection = n.section ?? lastSection;
            return (
              <div key={n.href}>
                {header ? <div className="nav-section">{header}</div> : null}
                <Link href={n.href} className="nav-link" aria-current={active(n.href) ? 'page' : undefined} title={n.label}>
                  <Icon name={n.icon} />
                  <span className="label-text">{n.label}</span>
                </Link>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          {me ? (
            <div className="small" style={{ padding: '0 12px' }}>
              <div style={{ fontWeight: 700 }} className="label-text">
                {me.fullName}
              </div>
              <div className="muted label-text">{me.organisation ? `${me.organisation.tradingName ?? me.organisation.legalName} · ${me.organisation.role.toLowerCase().replace(/_/g, ' ')}` : me.adminRole ? me.adminRole.toLowerCase().replace(/_/g, ' ') : (me.email ?? me.phone)}</div>
            </div>
          ) : null}
          <button className="nav-link btn-ghost" style={{ border: 0, background: 'none', cursor: 'pointer', font: 'inherit', width: '100%' }} onClick={() => void logout()}>
            <Icon name="logout" />
            <span className="label-text">Sign out</span>
          </button>
        </div>
      </aside>
      {open ? <div className="modal-backdrop" style={{ background: 'rgba(15,27,45,.25)', zIndex: 40 }} onClick={() => setOpen(false)} /> : null}
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-sm menu-btn" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <Icon name="menu" />
          </button>
          <div className="topbar-title">{title ?? visible.find((n) => active(n.href))?.label ?? brand}</div>
          {headerRight}
          <Link href="/notifications" className="btn btn-ghost btn-sm" aria-label="Notifications">
            <Icon name="bell" />
          </Link>
        </header>
        <main id="main" className={`content ${narrow ? 'narrow' : ''}`}>
          {children}
        </main>
        <nav className="bottom-nav" aria-label="Primary mobile">
          {visible
            .filter((n) => n.mobile)
            .slice(0, 5)
            .map((n) => (
              <Link key={n.href} href={n.href} aria-current={active(n.href) ? 'page' : undefined}>
                <Icon name={n.icon} size={22} />
                {n.label}
              </Link>
            ))}
        </nav>
      </div>
    </div>
  );
}
