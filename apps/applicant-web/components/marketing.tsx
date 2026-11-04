'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Card, Icon, InstallButton, SelectInput, TextArea, TextInput, formatMoney, useAction } from '@avn/ui';
import { api } from '@/lib/api';

const NAV = [
  ['/how-it-works', 'How it works'],
  ['/individuals', 'Individuals'],
  ['/institutions', 'Institutions'],
  ['/become-a-verifier', 'Become a verifier'],
  ['/pricing', 'Pricing'],
  ['/faq', 'FAQ'],
  ['/contact', 'Contact'],
] as const;

const BUSINESS_URL = process.env.NEXT_PUBLIC_BUSINESS_APP_URL ?? 'http://localhost:3002';
const AGENT_URL = process.env.NEXT_PUBLIC_VERIFIER_APP_URL ?? 'http://localhost:3001';

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', minHeight: '100vh' }}>
      <header style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="marketing-nav">
          <Link href="/" className="brand" style={{ padding: 0, textDecoration: 'none' }}>
            <span className="brand-mark">AVN</span>
            <span>Address Verification</span>
          </Link>
          <nav aria-label="Main">
            {NAV.map(([href, label]) => (
              <Link key={href} href={href}>
                {label}
              </Link>
            ))}
          </nav>
          <div className="row">
            <InstallButton />
            <Link href="/sign-in" className="btn btn-ghost btn-sm">
              Sign in
            </Link>
            <Link href="/sign-up" className="btn btn-primary btn-sm">
              Get verified
            </Link>
          </div>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="footer">
        <div className="section row between" style={{ padding: 0 }}>
          <span>© {new Date().getFullYear()} AVN — Digital Address Verification Network. Nigeria first, Africa next.</span>
          <span className="row">
            <Link href="/privacy">Privacy policy</Link>
            <Link href="/terms">Terms of service</Link>
            <Link href="/reports/verify">Check a report</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

export function Hero() {
  return (
    <section className="hero">
      <div className="stack">
        <span className="badge badge-primary" style={{ width: 'fit-content' }}>
          Physical verification · evidence-based reports
        </span>
        <h1>Prove where you live — verified by a real person, in minutes not weeks.</h1>
        <p className="lead">AVN connects you, an approved local field verifier and the institution that needs your address confirmed. GPS-stamped photos, transparent findings and a tamper-evident report.</p>
        <div className="row">
          <Link href="/sign-up" className="btn btn-primary btn-lg">
            Verify my address
          </Link>
          <a href={BUSINESS_URL} className="btn btn-secondary btn-lg">
            For institutions
          </a>
        </div>
        <div className="row small muted">
          <span className="row">
            <Icon name="shield" size={16} /> NDPA 2023-aligned
          </span>
          <span className="row">
            <Icon name="pin" size={16} /> Verifiers within ~15 min walk
          </span>
          <span className="row">
            <Icon name="file" size={16} /> Signed PDF reports
          </span>
        </div>
      </div>
      <Card>
        <div className="stack-sm">
          {[
            ['1', 'You submit your address and drop a pin', 'From your phone, wherever you are — you do not need to be at home.'],
            ['2', 'A nearby approved verifier accepts', 'Assignment uses real walking routes; your exact address is only shown after acceptance.'],
            ['3', 'Visit, photos and checklist', 'Camera-only evidence with GPS, timestamps and integrity hashes.'],
            ['4', 'Findings and a verifiable report', 'Building, address match, occupancy, presence and residency are reported separately.'],
          ].map(([n, t, d]) => (
            <div key={n} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <span className="brand-mark" style={{ width: 28, height: 28, flexShrink: 0 }}>
                {n}
              </span>
              <div>
                <strong>{t}</strong>
                <div className="small muted">{d}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}

export function ContentPage({ title, intro, sections, cta }: { title: string; intro: string; sections: Array<{ h: string; p: ReactNode }>; cta?: ReactNode }) {
  return (
    <div className="section" style={{ maxWidth: 880 }}>
      <h1 style={{ fontSize: '2rem' }}>{title}</h1>
      <p className="muted" style={{ fontSize: '1.05rem' }}>
        {intro}
      </p>
      <div className="stack" style={{ marginTop: 24 }}>
        {sections.map((s) => (
          <Card key={s.h}>
            <h2>{s.h}</h2>
            <div>{s.p}</div>
          </Card>
        ))}
      </div>
      {cta ? <div style={{ marginTop: 24 }}>{cta}</div> : null}
    </div>
  );
}

interface Plan {
  audience: string;
  level: string;
  price: string;
  currency: string;
  slaHours: number;
  bulkThreshold: number;
  bulkPrice: string | null;
}
export function PricingTable() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  useEffect(() => {
    void api.get<Plan[]>('/public/pricing').then(setPlans).catch(() => setPlans([]));
  }, []);
  if (!plans) return <p className="muted">Loading live pricing…</p>;
  const group = (aud: string) => plans.filter((p) => p.audience === aud);
  return (
    <div className="stack">
      {(['INDIVIDUAL', 'INSTITUTION'] as const).map((aud) => (
        <div key={aud}>
          <h2>{aud === 'INDIVIDUAL' ? 'For individuals' : 'For institutions (prepaid wallet)'}</h2>
          <div className="grid grid-3">
            {group(aud).map((p) => (
              <Card key={p.level}>
                <div className="stat-label">{p.level}</div>
                <div className="stat-value">{formatMoney(p.price, p.currency)}</div>
                <div className="small muted">Target completion within {p.slaHours} hours</div>
                {p.bulkPrice ? <div className="small">Volume price {formatMoney(p.bulkPrice, p.currency)} after {p.bulkThreshold} requests/month</div> : null}
              </Card>
            ))}
          </div>
        </div>
      ))}
      <p className="small muted">Prices are configured by the platform per country and level. Verifiers are paid for every completed visit — including when the applicant is not home.</p>
    </div>
  );
}

export function ContactForm() {
  const [form, setForm] = useState({ name: '', email: '', organisation: '', topic: 'INDIVIDUAL', message: '' });
  const [done, setDone] = useState(false);
  const send = useAction(async () => {
    await api.post('/public/contact', form);
    setDone(true);
  });
  const fe = send.error?.fieldErrors() ?? {};
  if (done) return <Alert tone="success">Thanks — your message has reached our operations team. We usually reply within one business day.</Alert>;
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void send.run();
      }}
    >
      {send.error && !Object.keys(fe).length ? <Alert tone="danger">{send.error.message}</Alert> : null}
      <div className="grid grid-2">
        <TextInput label="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={fe.name} required />
        <TextInput label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={fe.email} required />
      </div>
      <div className="grid grid-2">
        <TextInput label="Organisation (optional)" value={form.organisation} onChange={(e) => setForm({ ...form, organisation: e.target.value })} />
        <SelectInput
          label="Topic"
          value={form.topic}
          onChange={(e) => setForm({ ...form, topic: e.target.value })}
          options={[
            { value: 'INDIVIDUAL', label: 'Individual verification' },
            { value: 'INSTITUTION', label: 'Institutional partnership' },
            { value: 'VERIFIER', label: 'Becoming a verifier' },
            { value: 'PRIVACY', label: 'Privacy / data request' },
            { value: 'OTHER', label: 'Something else' },
          ]}
        />
      </div>
      <TextArea label="Message" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} error={fe.message} required />
      <Button type="submit" loading={send.pending}>
        Send message
      </Button>
    </form>
  );
}

export const LINKS = { BUSINESS_URL, AGENT_URL };
