'use client';
import Link from 'next/link';
import { Card, ErrorAlert, PageHeader, Spinner, Stat, formatMoney, humanize, useApi } from '@avn/ui';
import { api } from '@/lib/api';

interface Overview {
  totalUsers: number;
  usersByType: Array<{ type: string; count: number }>;
  totalInstitutions: number;
  approvedVerifiers: number;
  currentlyAvailableVerifiers: number;
  activeAssignments: number;
  completedVerifications: number;
  pendingManualReviews: number;
  suspiciousAssignments: number;
  totalRevenue: string;
  verifierPayouts: string;
  geographicCoverage: Array<{ state: string; requests: number }>;
  queues: { pendingVerifierApprovals: number; pendingOrganisationApprovals: number };
}

export default function Page() {
  const q = useApi<Overview>(api, '/admin/overview', { pollMs: 20000 });
  if (q.loading) return <Spinner />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const o = q.data!;
  const max = Math.max(1, ...o.geographicCoverage.map((g) => g.requests));
  return (
    <>
      <PageHeader title="Platform overview" subtitle="Live operational, commercial and quality metrics." />
      <div className="grid grid-4">
        <Stat label="Total users" value={o.totalUsers} hint={o.usersByType.map((u) => `${humanize(u.type)} ${u.count}`).join(' · ')} />
        <Stat label="Institutions" value={o.totalInstitutions} hint={<Link href="/organisations">{o.queues.pendingOrganisationApprovals} awaiting approval</Link>} />
        <Stat label="Approved verifiers" value={o.approvedVerifiers} hint={<Link href="/verifiers?status=MANUAL_REVIEW">{o.queues.pendingVerifierApprovals} awaiting approval</Link>} />
        <Stat label="Available now" value={o.currentlyAvailableVerifiers} hint="Fresh heartbeat only" tone="success" />
        <Stat label="Active assignments" value={o.activeAssignments} hint={<Link href="/map">Open live map</Link>} />
        <Stat label="Completed verifications" value={o.completedVerifications} />
        <Stat label="Pending manual reviews" value={o.pendingManualReviews} tone={o.pendingManualReviews ? 'warning' : undefined} hint={<Link href="/reviews">Review queue</Link>} />
        <Stat label="Suspicious (high-risk open)" value={o.suspiciousAssignments} tone={o.suspiciousAssignments ? 'danger' : undefined} hint={<Link href="/fraud">Investigate</Link>} />
        <Stat label="Total revenue" value={formatMoney(o.totalRevenue)} />
        <Stat label="Verifier payouts" value={formatMoney(o.verifierPayouts)} />
      </div>
      <Card title="Geographic coverage (requests by state)">
        <div className="stack-sm">
          {o.geographicCoverage.map((g) => (
            <div key={g.state} className="hbar">
              <span>{g.state}</span>
              <div className="track"><div className="fill" style={{ width: `${(g.requests / max) * 100}%` }} /></div>
              <span className="small">{g.requests}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
