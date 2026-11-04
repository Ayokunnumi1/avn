'use client';
import Link from 'next/link';
import { useState } from 'react';
import { DataTable, PageHeader, SelectInput, Spinner, ToneBadge, formatDateTime, humanize, useApi, useToast } from '@avn/ui';
import { api } from '@/lib/api';
import { ConfirmAction } from '@/components/confirm';

interface S { id: string; requestId: string | null; rule: string; severity: string; score: number; explanation: string; status: string; createdAt: string; request: { reference: string } | null; verifier: { user: { fullName: string } } | null }

export default function Page() {
  const toast = useToast();
  const [status, setStatus] = useState('OPEN');
  const q = useApi<S[]>(api, `/admin/fraud?status=${status}`);
  return (
    <>
      <PageHeader title="Fraud signals" subtitle="Deterministic, explainable rules. High-severity signals always enter human review." />
      <div style={{ maxWidth: 260 }}><SelectInput label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={['OPEN', 'CONFIRMED_FRAUD', 'FALSE_POSITIVE'].map((s) => ({ value: s, label: humanize(s) }))} /></div>
      {q.loading ? <Spinner /> : <DataTable rows={q.data ?? []} rowKey={(s) => s.id} empty="No signals" columns={[
        { key: 'sev', header: 'Severity', render: (s) => <ToneBadge value={s.severity} /> },
        { key: 'r', header: 'Rule', render: (s) => <strong>{humanize(s.rule)}</strong> },
        { key: 'x', header: 'Explanation', render: (s) => <span className="small">{s.explanation}</span> },
        { key: 'q', header: 'Request', render: (s) => (s.requestId ? <Link className="mono small" href={`/requests/${s.requestId}`}>{s.request?.reference}</Link> : '—') },
        { key: 'v', header: 'Verifier', render: (s) => s.verifier?.user.fullName ?? '—' },
        { key: 'd', header: 'Raised', render: (s) => formatDateTime(s.createdAt) },
        { key: 'a', header: '', render: (s) => (s.status === 'OPEN' ? <span className="row"><ConfirmAction trigger="Confirm fraud" variant="danger" title="Confirm fraud" onConfirm={async ({ reason }) => { await api.post(`/admin/fraud/${s.id}/resolve`, { resolution: 'CONFIRMED_FRAUD', note: reason }); toast('Recorded'); await q.reload(); }} /><ConfirmAction trigger="False positive" variant="secondary" title="Mark false positive" onConfirm={async ({ reason }) => { await api.post(`/admin/fraud/${s.id}/resolve`, { resolution: 'FALSE_POSITIVE', note: reason }); await q.reload(); }} /></span> : <ToneBadge value={s.status} />) },
      ]} />}
    </>
  );
}
