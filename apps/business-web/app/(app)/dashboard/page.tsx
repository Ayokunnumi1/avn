'use client';
import Link from 'next/link';
import { Card, ErrorAlert, PageHeader, Spinner, Stat, StatusBadge, formatMoney, humanize, useApi, useAuth } from '@avn/ui';
import { api } from '@/lib/api';

interface Dash {
  totalRequests: number;
  pendingApplicantSubmissions: number;
  awaitingVerifierAssignment: number;
  inProgressVisits: number;
  completedVerifications: number;
  reportsRequiringReview: number;
  failedOrCancelled: number;
  monthlyExpenditure: string;
  averageTurnaroundHours: number | null;
  outcomeStatistics: Array<{ outcome: string; count: number }>;
  statusBreakdown: Array<{ status: string; count: number }>;
  dailyVolume: Array<{ day: string; count: number }>;
}

export default function Dashboard() {
  const { me, can } = useAuth();
  const q = useApi<Dash>(api, '/org/dashboard', { pollMs: 30000 });
  if (q.loading) return <Spinner />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const d = q.data!;
  const outcomeTotal = d.outcomeStatistics.reduce((n, o) => n + o.count, 0) || 1;
  const maxDay = Math.max(1, ...d.dailyVolume.map((x) => x.count));
  return (
    <>
      <PageHeader title={me?.organisation?.tradingName ?? me?.organisation?.legalName ?? 'Dashboard'} subtitle="Verification operations at a glance" actions={can('requests.create') ? <Link className="btn btn-primary" href="/requests/new">New verification</Link> : null} />
      <div className="grid grid-4">
        <Stat label="Total requests" value={d.totalRequests} />
        <Stat label="Pending applicant submission" value={d.pendingApplicantSubmissions} />
        <Stat label="Awaiting verifier" value={d.awaitingVerifierAssignment} />
        <Stat label="Visits in progress" value={d.inProgressVisits} />
        <Stat label="Completed" value={d.completedVerifications} tone="success" />
        <Stat label="Requiring review" value={d.reportsRequiringReview} tone={d.reportsRequiringReview ? 'warning' : undefined} />
        <Stat label="Failed / cancelled" value={d.failedOrCancelled} />
        <Stat label="Spend this month" value={formatMoney(d.monthlyExpenditure)} hint={d.averageTurnaroundHours != null ? `Avg turnaround ${d.averageTurnaroundHours} h` : 'No completed verifications yet'} />
      </div>
      <div className="grid grid-2">
        <Card title="Verification outcomes">
          <div className="stack-sm">
            {d.outcomeStatistics.length === 0 ? <p className="muted">No outcomes yet.</p> : d.outcomeStatistics.map((o) => (
              <div key={o.outcome} className="hbar">
                <span>{humanize(o.outcome)}</span>
                <div className="track" role="img" aria-label={`${o.count} ${o.outcome}`}><div className="fill" style={{ width: `${(o.count / outcomeTotal) * 100}%` }} /></div>
                <span className="small">{o.count}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Requests per day (30 days)">
          {d.dailyVolume.length ? (
            <div className="chart-bars" role="img" aria-label="Daily request volume">
              {d.dailyVolume.map((x) => <div key={x.day} title={`${x.day.slice(0, 10)}: ${x.count}`} style={{ height: `${(x.count / maxDay) * 100}%` }} />)}
            </div>
          ) : <p className="muted">No requests in the last 30 days.</p>}
        </Card>
      </div>
      <Card title="Status breakdown">
        <div className="row">
          {d.statusBreakdown.map((s) => (
            <Link key={s.status} href={`/requests?status=${s.status}`} className="row" style={{ color: 'inherit' }}>
              <StatusBadge status={s.status} /> <strong>{s.count}</strong>
            </Link>
          ))}
        </div>
      </Card>
    </>
  );
}
