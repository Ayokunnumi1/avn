'use client';
import Link from 'next/link';
import { DataTable, PageHeader, Spinner, ToneBadge, formatDateTime, humanize, useApi, useToast } from '@avn/ui';
import { api } from '@/lib/api';
import { ConfirmAction } from '@/components/confirm';

interface D { id: string; requestId: string; raisedByType: string; reason: string; details: string; status: string; createdAt: string; request: { reference: string; outcome: string | null } }

export default function Page() {
  const toast = useToast();
  const q = useApi<D[]>(api, '/admin/disputes');
  const resolve = (id: string, decision: string) => async ({ reason }: { reason: string }) => {
    await api.post(`/admin/disputes/${id}/resolve`, { decision, resolutionNote: reason });
    toast(decision === 'UPHELD' ? 'Upheld — request reopened for manual review' : 'Dispute rejected');
    await q.reload();
  };
  return (
    <>
      <PageHeader title="Disputes" subtitle="Upheld disputes reopen the verification for manual review." />
      {q.loading ? <Spinner /> : <DataTable rows={q.data ?? []} rowKey={(d) => d.id} empty="No open disputes" columns={[
        { key: 'r', header: 'Request', render: (d) => <Link className="mono" href={`/requests/${d.requestId}`}>{d.request.reference}</Link> },
        { key: 'o', header: 'Outcome', render: (d) => humanize(d.request.outcome) },
        { key: 'b', header: 'Raised by', render: (d) => humanize(d.raisedByType) },
        { key: 'x', header: 'Reason', render: (d) => <div><strong>{d.reason}</strong><div className="small">{d.details}</div></div> },
        { key: 's', header: 'Status', render: (d) => <ToneBadge value={d.status} /> },
        { key: 't', header: 'Raised', render: (d) => formatDateTime(d.createdAt) },
        { key: 'a', header: '', render: (d) => <span className="row"><ConfirmAction trigger="Uphold" title="Uphold dispute" onConfirm={resolve(d.id, 'UPHELD')} /><ConfirmAction trigger="Reject" variant="secondary" title="Reject dispute" onConfirm={resolve(d.id, 'REJECTED')} /></span> },
      ]} />}
    </>
  );
}
