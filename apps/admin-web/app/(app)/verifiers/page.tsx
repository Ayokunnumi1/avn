'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { VERIFIER_STATUSES } from '@avn/contracts';
import { DataTable, PageHeader, Pagination, SelectInput, Spinner, TextInput, ToneBadge, formatDate, humanize, timeAgo, useApi } from '@avn/ui';
import { api } from '@/lib/api';

interface Row { id: string; fullName: string; phone: string; email: string; status: string; reliabilityScore: string; completedCount: number; available: boolean; lastHeartbeatAt: string | null; createdAt: string }

function Inner() {
  const router = useRouter();
  const [status, setStatus] = useState(useSearchParams().get('status') ?? '');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const data = useApi<{ items: Row[]; total: number; page: number; pageSize: number }>(api, `/admin/verifiers?page=${page}&pageSize=25${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  return (
    <>
      <PageHeader title="Verifiers" subtitle="Registration review, identity results, approvals and performance." />
      <div className="grid grid-3">
        <SelectInput label="Status" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }} options={[{ value: '', label: 'All' }, ...VERIFIER_STATUSES.map((s) => ({ value: s, label: humanize(s) }))]} />
        <TextInput label="Search" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} />
      </div>
      {data.loading ? <Spinner /> : (
        <>
          <DataTable rows={data.data!.items} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/verifiers/${r.id}`)} columns={[
            { key: 'n', header: 'Name', render: (r) => <div><strong>{r.fullName}</strong><div className="small muted">{r.phone}</div></div> },
            { key: 's', header: 'Status', render: (r) => <ToneBadge value={r.status} /> },
            { key: 'a', header: 'On duty', render: (r) => (r.available ? `Yes · ${timeAgo(r.lastHeartbeatAt)}` : 'No') },
            { key: 'r', header: 'Reliability', render: (r) => r.reliabilityScore },
            { key: 'c', header: 'Completed', render: (r) => r.completedCount },
            { key: 'd', header: 'Registered', render: (r) => formatDate(r.createdAt) },
          ]} />
          <Pagination page={data.data!.page} pageSize={data.data!.pageSize} total={data.data!.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
export default function Page() {
  return <Suspense fallback={<Spinner />}><Inner /></Suspense>;
}
