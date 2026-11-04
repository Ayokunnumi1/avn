'use client';
import Link from 'next/link';
import { Alert, Badge, Button, Card, ErrorAlert, Spinner, Stat, StatusBadge, formatMoney, humanize, timeAgo, useApi } from '@avn/ui';
import { api } from '@/lib/api';
import { useDuty } from '@/components/duty';

interface Me {
  fullName: string;
  status: string;
  decisionReason: string | null;
  onboarding: { photo: boolean; identity: boolean; payoutAccount: boolean };
  availability: { available: boolean; locationSharing: 'LIVE' | 'STALE' | 'OFF'; lastHeartbeatAt: string | null; heartbeatExpirySeconds: number };
  nearbyOffers: number;
  todayCompleted: number;
  wallet: { pending: string; available: string; totalEarned: string; currency: string };
  reliabilityScore: string;
  recentAssignments: Array<{ id: string; reference: string; status: string; requestStatus: string; area: string; acceptedAt: string; reward: string }>;
}

export default function Dashboard() {
  const duty = useDuty();
  const q = useApi<Me>(api, '/verifiers/me', { pollMs: 15000 });
  if (q.loading) return <Spinner />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const v = q.data!;
  const approved = v.status === 'APPROVED';
  return (
    <div className="stack">
      <div>
        <h1 style={{ marginBottom: 2 }}>Hi, {v.fullName.split(' ')[0]}</h1>
        <div className="row small">
          <Badge tone={approved ? 'success' : v.status === 'SUSPENDED' || v.status === 'REJECTED' ? 'danger' : 'warning'}>{humanize(v.status)}</Badge>
          <span className="muted">Reliability {v.reliabilityScore}</span>
        </div>
      </div>
      {!approved ? (
        <Alert tone="warning" title="You can't receive paid jobs yet">
          {v.status === 'INCOMPLETE' || v.status === 'IDENTITY_PENDING' ? 'Finish onboarding: profile photo, identity verification and payout account.' : v.status === 'MANUAL_REVIEW' ? 'Your identity details are with our team for approval.' : v.decisionReason ?? 'Contact support.'}{' '}
          <Link href="/profile">Go to profile</Link>
        </Alert>
      ) : null}
      <Card>
        <div className="stack">
          <div className="row between">
            <div>
              <div className="stat-label">Availability</div>
              <div className="stat-value" style={{ color: duty.available ? 'var(--success)' : 'var(--muted)' }}>{duty.available ? 'Available' : 'Unavailable'}</div>
              <div className="small muted">
                Location sharing: {duty.available ? 'live while this app is open' : 'off'}
                {duty.fix ? ` · ±${Math.round(duty.fix.accuracy)} m` : ''}
              </div>
            </div>
            {duty.available ? (
              <Button variant="secondary" size="lg" onClick={() => void duty.goUnavailable()}>
                Go unavailable
              </Button>
            ) : (
              <Button size="lg" disabled={!approved} loading={duty.starting} onClick={() => void duty.goAvailable()}>
                Go available
              </Button>
            )}
          </div>
          {duty.error ? <Alert tone="warning">{duty.error}</Alert> : null}
          <p className="small muted" style={{ margin: 0 }}>Web apps cannot track location in the background. Keep AVN Agent open while on duty; you'll go unavailable automatically if updates stop for {Math.round(v.availability.heartbeatExpirySeconds / 60)} minutes.</p>
        </div>
      </Card>
      <div className="grid grid-2">
        <Stat label="Nearby jobs" value={duty.offers || v.nearbyOffers} hint={<Link href="/jobs">View offers</Link>} />
        <Stat label="Completed today" value={v.todayCompleted} />
        <Stat label="Pending earnings" value={formatMoney(v.wallet.pending, v.wallet.currency)} />
        <Stat label="Available balance" value={formatMoney(v.wallet.available, v.wallet.currency)} hint={`Total earned ${formatMoney(v.wallet.totalEarned, v.wallet.currency)}`} />
      </div>
      <Card title="Recent assignments">
        {v.recentAssignments.length ? (
          <div className="stack-sm">
            {v.recentAssignments.map((a) => (
              <Link key={a.id} href={`/assignments/${a.id}`} className="row between" style={{ color: 'inherit' }}>
                <span className="mono small">{a.reference}</span>
                <span className="small muted">{a.area}</span>
                <StatusBadge status={a.requestStatus} />
                <span className="small muted">{timeAgo(a.acceptedAt)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="muted">No assignments yet. Go available to receive nearby jobs.</p>
        )}
      </Card>
    </div>
  );
}
