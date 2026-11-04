'use client';
import { useState } from 'react';
import { ORG_STATUSES } from '@avn/contracts';
import { DataTable, PageHeader, Pagination, SelectInput, Spinner, TextInput, ToneBadge, formatDate, formatMoney, humanize, useApi, useToast } from '@avn/ui';
import { api } from '@/lib/api';
import { ConfirmAction } from '@/components/confirm';

interface Org { id: string; legalName: string; registrationNumber: string; businessType: string; status: string; contactEmail: string; expectedMonthlyVolume: number; requests: number; members: number; walletBalance: string; postpaidEnabled: boolean; creditLimit: string; createdAt: string }

export default function Page() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [credit, setCredit] = useState('0');
  const q = useApi<{ items: Org[]; total: number; page: number; pageSize: number }>(api, `/admin/organisations?page=${page}&pageSize=25${status ? `&status=${status}` : ''}`);
  const decide = (id: string, decision: string, withCredit = false) => async ({ reason }: { reason: string }) => {
    await api.post(`/admin/organisations/${id}/decision`, { decision, reason, ...(withCredit ? { postpaidCreditLimit: credit } : {}) });
    toast(`Organisation ${decision.toLowerCase()}d`);
    await q.reload();
  };
  return (
    <>
      <PageHeader title="Institutions" subtitle="Organisation approval is controlled by platform administration." />
      <div style={{ maxWidth: 280 }}><SelectInput label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All' }, ...ORG_STATUSES.map((s) => ({ value: s, label: humanize(s) }))]} /></div>
      {q.loading ? <Spinner /> : (
        <>
          <DataTable rows={q.data!.items} rowKey={(o) => o.id} columns={[
            { key: 'n', header: 'Organisation', render: (o) => <div><strong>{o.legalName}</strong><div className="small muted">{o.registrationNumber} · {humanize(o.businessType)} · {o.contactEmail}</div></div> },
            { key: 's', header: 'Status', render: (o) => <ToneBadge value={o.status} /> },
            { key: 'v', header: 'Volume', render: (o) => `${o.requests} req · ${o.members} staff · ~${o.expectedMonthlyVolume}/mo` },
            { key: 'w', header: 'Wallet', render: (o) => `${formatMoney(o.walletBalance)}${o.postpaidEnabled ? ` · credit ${formatMoney(o.creditLimit)}` : ''}` },
            { key: 'd', header: 'Registered', render: (o) => formatDate(o.createdAt) },
            { key: 'a', header: '', render: (o) => (
              <span className="row">
                {o.status === 'PENDING_REVIEW' ? <><ConfirmAction trigger="Approve" title={`Approve ${o.legalName}`} onConfirm={decide(o.id, 'APPROVE')} /><ConfirmAction trigger="Reject" variant="danger" title={`Reject ${o.legalName}`} onConfirm={decide(o.id, 'REJECT')} /></> : null}
                {o.status === 'APPROVED' ? <><ConfirmAction trigger="Postpaid credit" variant="secondary" title="Set postpaid credit limit" onConfirm={decide(o.id, 'APPROVE', true)}><TextInput label="Credit limit (NGN, 0 disables)" value={credit} onChange={(e) => setCredit(e.target.value.replace(/[^\d.]/g, ''))} /></ConfirmAction><ConfirmAction trigger="Suspend" variant="danger" title={`Suspend ${o.legalName}`} onConfirm={decide(o.id, 'SUSPEND')} /></> : null}
                {o.status === 'SUSPENDED' ? <ConfirmAction trigger="Reinstate" title="Reinstate" onConfirm={decide(o.id, 'REINSTATE')} /> : null}
              </span>
            ) },
          ]} />
          <Pagination page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
