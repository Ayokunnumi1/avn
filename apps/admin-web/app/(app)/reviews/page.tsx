'use client';
import { useRouter } from 'next/navigation';
import { DataTable, PageHeader, Spinner, ToneBadge, formatDateTime, humanize, useApi } from '@avn/ui';
import { api } from '@/lib/api';

interface R { id: string; requestId: string; reference: string; organisation: string; status: string; trigger: string; reasons: string[]; riskScore: number; createdAt: string }

export default function Page() {
  const router = useRouter();
  const q = useApi<R[]>(api, '/admin/reviews', { pollMs: 20000 });
  return (
    <>
      <PageHeader title="Manual review queue" subtitle="Exceptions routed by the deterministic engine: risk, GPS, partial matches, disputes." />
      {q.loading ? <Spinner /> : <DataTable rows={q.data ?? []} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/requests/${r.requestId}`)} empty="Queue is clear" columns={[
        { key: 'r', header: 'Request', render: (r) => <span className="mono">{r.reference}</span> },
        { key: 'o', header: 'Client', render: (r) => r.organisation },
        { key: 't', header: 'Trigger', render: (r) => humanize(r.trigger) },
        { key: 'x', header: 'Reasons', render: (r) => <span className="small">{r.reasons.join('; ')}</span> },
        { key: 'k', header: 'Risk', render: (r) => r.riskScore },
        { key: 's', header: 'Status', render: (r) => <ToneBadge value={r.status} /> },
        { key: 'd', header: 'Waiting since', render: (r) => formatDateTime(r.createdAt) },
      ]} />}
    </>
  );
}
