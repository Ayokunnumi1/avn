'use client';
import Link from 'next/link';
import { Alert, Card, EmptyState, ErrorAlert, Spinner, Stat, StatusBadge, formatDateTime, useApi, useAuth } from '@avn/ui';
import { api } from '@/lib/api';

interface Dash {
  greeting: string;
  total: number;
  pending: number;
  completed: number;
  requiresAttention: number;
  recentActivity: Array<{ requestId: string; reference: string; status: string; label: string; at: string }>;
}

export default function Dashboard() {
  const { me } = useAuth();
  const q = useApi<Dash>(api, '/me/dashboard', { pollMs: 30000 });
  if (q.loading) return <Spinner />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const d = q.data!;
  return (
    <div className="stack">
      <div className="row between">
        <div>
          <h1>Hello, {d.greeting}</h1>
          <p className="muted" style={{ margin: 0 }}>Here is where your address verifications stand.</p>
        </div>
        {!me?.isGuest ? (
          <Link href="/verifications/new" className="btn btn-primary">
            Start new verification
          </Link>
        ) : null}
      </div>
      {me?.isGuest ? <Alert tone="info">You are using a secure institution link. Sign in with your phone number any time to keep a permanent account.</Alert> : null}
      {d.requiresAttention > 0 ? (
        <Alert tone="warning" title="Action needed">
          {d.requiresAttention} verification{d.requiresAttention > 1 ? 's need' : ' needs'} your details or payment. <Link href="/verifications">Review now</Link>
        </Alert>
      ) : null}
      <div className="grid grid-4">
        <Stat label="Total requests" value={d.total} />
        <Stat label="In progress" value={d.pending} />
        <Stat label="Completed" value={d.completed} />
        <Stat label="Needs attention" value={d.requiresAttention} tone={d.requiresAttention ? 'warning' : undefined} />
      </div>
      <Card title="Recent activity">
        {d.recentActivity.length === 0 ? (
          <EmptyState title="No activity yet">Start a verification to see progress here.</EmptyState>
        ) : (
          <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {d.recentActivity.map((a, i) => (
              <li key={i} className="row between">
                <Link href={`/verifications/${a.requestId}`} className="mono">
                  {a.reference}
                </Link>
                <StatusBadge status={a.status} />
                <span className="small muted">{formatDateTime(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
