'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { REQUEST_STATUSES, STATUS_LABELS } from '@avn/contracts';
import { Badge, DataTable, PageHeader, Pagination, SelectInput, Spinner, StatusBadge, TextInput, formatDateTime, humanize, useApi } from '@avn/ui';
import { api } from '@/lib/api';

interface Row { id: string; reference: string; status: string; source: string; organisation: string; applicantName: string; location: string; verifier: string | null; riskScore: number; riskFlagged: boolean; coverageFallback: string | null; deadline: string | null; updatedAt: string }

export default function Page() {
  const router = useRouter();
  const [f, setF] = useState({ status: '', q: '', state: '', risk: '' });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams(Object.entries({ ...f, page: String(page), pageSize: '25' }).filter(([, v]) => v) as [string, string][]).toString();
  const q = useApi<{ items: Row[]; total: number; page: number; pageSize: number }>(api, `/admin/requests?${qs}`, { pollMs: 20000 });
  return (
    <>
      <PageHeader title="Assignments" subtitle="Monitor, reassign, cancel and investigate delays across the network." />
      <div className="grid grid-4">
        <TextInput label="Search" value={f.q} onChange={(e) => { setPage(1); setF({ ...f, q: e.target.value }); }} />
        <SelectInput label="Status" value={f.status} onChange={(e) => { setPage(1); setF({ ...f, status: e.target.value }); }} options={[{ value: '', label: 'All' }, ...REQUEST_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))]} />
        <TextInput label="State" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} />
        <SelectInput label="Risk" value={f.risk} onChange={(e) => setF({ ...f, risk: e.target.value })} options={[{ value: '', label: 'All' }, { value: 'flagged', label: 'Flagged' }]} />
      </div>
      {q.loading ? <Spinner /> : (
        <>
          <DataTable rows={q.data!.items} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/requests/${r.id}`)} columns={[
            { key: 'r', header: 'Reference', render: (r) => <span className="mono">{r.reference}</span> },
            { key: 's', header: 'Status', render: (r) => <span className="row"><StatusBadge status={r.status} />{r.riskFlagged ? <Badge tone="danger">Risk {r.riskScore}</Badge> : null}{r.coverageFallback ? <Badge tone="warning">No coverage</Badge> : null}</span> },
            { key: 'o', header: 'Client', render: (r) => r.organisation },
            { key: 'a', header: 'Applicant', render: (r) => r.applicantName },
            { key: 'l', header: 'Location', render: (r) => r.location || '—' },
            { key: 'v', header: 'Verifier', render: (r) => r.verifier ?? '—' },
            { key: 'src', header: 'Source', render: (r) => humanize(r.source) },
            { key: 'u', header: 'Updated', render: (r) => formatDateTime(r.updatedAt) },
          ]} />
          <Pagination page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
