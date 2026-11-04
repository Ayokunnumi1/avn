'use client';
import { useState } from 'react';
import { DataTable, PageHeader, Pagination, Spinner, TextInput, formatDateTime, useApi } from '@avn/ui';
import { api } from '@/lib/api';

interface Ev { id: string; action: string; entityType: string; entityId: string | null; actorType: string; actorLabel: string | null; ipAddress: string | null; metadata: unknown; createdAt: string }

export default function Page() {
  const [f, setF] = useState({ action: '', entityType: '', entityId: '' });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams(Object.entries({ ...f, page: String(page), pageSize: '30' }).filter(([, v]) => v) as [string, string][]).toString();
  const q = useApi<{ items: Ev[]; total: number; page: number; pageSize: number }>(api, `/admin/audit?${qs}`);
  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only record of sensitive and administrative actions, including login history." />
      <div className="grid grid-3">
        <TextInput label="Action prefix" placeholder="auth. / payout. / config." value={f.action} onChange={(e) => { setPage(1); setF({ ...f, action: e.target.value }); }} />
        <TextInput label="Entity type" value={f.entityType} onChange={(e) => setF({ ...f, entityType: e.target.value })} />
        <TextInput label="Entity id" value={f.entityId} onChange={(e) => setF({ ...f, entityId: e.target.value })} />
      </div>
      {q.loading ? <Spinner /> : <>
        <DataTable rows={q.data!.items} rowKey={(e) => e.id} columns={[{ key: 't', header: 'When', render: (e) => formatDateTime(e.createdAt) }, { key: 'a', header: 'Action', render: (e) => <span className="mono small">{e.action}</span> }, { key: 'w', header: 'Actor', render: (e) => `${e.actorLabel ?? ''} (${e.actorType})` }, { key: 'e', header: 'Entity', render: (e) => <span className="small">{e.entityType} {e.entityId?.slice(0, 8)}</span> }, { key: 'ip', header: 'IP', render: (e) => e.ipAddress ?? '—' }, { key: 'm', header: 'Details', render: (e) => <details><summary className="small">view</summary><pre className="mono small" style={{ whiteSpace: 'pre-wrap', maxWidth: 380 }}>{JSON.stringify(e.metadata, null, 2)}</pre></details> }]} />
        <Pagination page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={setPage} />
      </>}
    </>
  );
}
