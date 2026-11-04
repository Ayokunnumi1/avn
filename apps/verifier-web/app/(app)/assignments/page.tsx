'use client';
import { useRouter } from 'next/navigation';
import { DataTable, PageHeader, Spinner, StatusBadge, formatDateTime, formatMoney, useApi } from '@avn/ui';
import { api } from '@/lib/api';

interface Row { id: string; status: string; reference: string; requestStatus: string; area: string; reward: string; acceptedAt: string; submittedAt: string | null }

export default function Page() {
  const router = useRouter();
  const q = useApi<Row[]>(api, '/assignments');
  return (
    <>
      <PageHeader title="My visits" />
      {q.loading ? <Spinner /> : (
        <DataTable rows={q.data ?? []} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/assignments/${r.id}`)} empty="No visits yet"
          columns={[
            { key: 'ref', header: 'Job', render: (r) => <span className="mono small">{r.reference}</span> },
            { key: 'area', header: 'Area', render: (r) => r.area },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.requestStatus} /> },
            { key: 'reward', header: 'Reward', render: (r) => formatMoney(r.reward) },
            { key: 'at', header: 'Accepted', render: (r) => formatDateTime(r.acceptedAt) },
          ]} />
      )}
    </>
  );
}
