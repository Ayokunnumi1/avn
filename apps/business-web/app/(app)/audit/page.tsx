'use client';
import { useState } from 'react';
import { DataTable, ErrorAlert, PageHeader, Pagination, Spinner, TextInput, formatDateTime, useApi } from '@avn/ui';
import { api } from '@/lib/api';

interface Ev { id: string; action: string; entityType: string; entityId: string | null; actorType: string; actorLabel: string | null; ipAddress: string | null; createdAt: string }

export default function Page() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const q = useApi<{ items: Ev[]; total: number; page: number; pageSize: number }>(api, `/org/audit?page=${page}&pageSize=25${action ? `&action=${encodeURIComponent(action)}` : ''}`);
  return (
    <>
      <PageHeader title="Audit trail" subtitle="Every sensitive action in your organisation." />
      <div style={{ maxWidth: 320 }}><TextInput label="Filter by action prefix" placeholder="e.g. request. or evidence." value={action} onChange={(e) => { setPage(1); setAction(e.target.value); }} /></div>
      {q.loading ? <Spinner /> : q.error ? <ErrorAlert error={q.error} /> : (
        <>
          <DataTable rows={q.data!.items} rowKey={(e) => e.id} columns={[{ key: 't', header: 'When', render: (e) => formatDateTime(e.createdAt) }, { key: 'a', header: 'Action', render: (e) => <span className="mono small">{e.action}</span> }, { key: 'w', header: 'Who', render: (e) => e.actorLabel ?? e.actorType }, { key: 'e', header: 'Entity', render: (e) => <span className="small">{e.entityType} {e.entityId?.slice(0, 8)}</span> }, { key: 'ip', header: 'IP', render: (e) => e.ipAddress ?? '—' }]} />
          <Pagination page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
