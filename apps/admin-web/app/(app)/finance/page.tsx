'use client';
import { useState } from 'react';
import { Alert, Badge, Button, Card, DataTable, PageHeader, Pagination, SelectInput, Spinner, ToneBadge, formatDateTime, formatMoney, humanize, useAction, useApi, useAuth, useToast } from '@avn/ui';
import { api } from '@/lib/api';
import { ConfirmAction } from '@/components/confirm';

interface Payout { id: string; reference: string; verifier: string; amount: string; status: string; bankName: string; accountLast4: string; provider: string; createdAt: string; failureReason: string | null }
interface Payment { id: string; reference: string; purpose: string; status: string; amount: string; provider: string; organisation: string | null; paidAt: string | null; reconciledAt: string | null; createdAt: string }
interface Wallet { id: string; ownerType: string; owner: string; available: string; pending: string; held: string; updatedAt: string }

export default function Page() {
  const toast = useToast();
  const { can } = useAuth();
  const [payoutStatus, setPayoutStatus] = useState('REQUESTED');
  const [page, setPage] = useState(1);
  const payouts = useApi<Payout[]>(api, `/admin/finance/payouts?status=${payoutStatus}`);
  const payments = useApi<{ items: Payment[]; total: number; page: number; pageSize: number }>(api, `/admin/finance/payments?page=${page}&pageSize=15`);
  const wallets = useApi<Wallet[]>(api, '/admin/finance/wallets');
  const [recon, setRecon] = useState<string>();
  const reconcile = useAction(async () => {
    const r = await api.post<{ reverified: unknown[]; ledgerMismatches: number }>('/admin/finance/reconcile');
    setRecon(`Re-verified ${r.reverified.length} pending payment(s) with the provider; ${r.ledgerMismatches} ledger mismatch(es).`);
    await payments.reload();
  });
  return (
    <>
      <PageHeader title="Finance" subtitle="Separate finance permissions. Payout approval and refunds require password re-confirmation." actions={can('finance.manage') ? <Button variant="secondary" loading={reconcile.pending} onClick={() => void reconcile.run()}>Run reconciliation</Button> : null} />
      {recon ? <Alert tone="info">{recon}</Alert> : null}
      <Card title="Verifier payouts" actions={<div style={{ width: 200 }}><SelectInput label="Status" value={payoutStatus} onChange={(e) => setPayoutStatus(e.target.value)} options={['REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED'].map((s) => ({ value: s, label: humanize(s) }))} /></div>}>
        {payouts.loading ? <Spinner /> : <DataTable rows={payouts.data ?? []} rowKey={(p) => p.id} empty="Nothing here" columns={[
          { key: 'r', header: 'Reference', render: (p) => <span className="mono small">{p.reference}</span> },
          { key: 'v', header: 'Verifier', render: (p) => p.verifier },
          { key: 'a', header: 'Amount', render: (p) => formatMoney(p.amount) },
          { key: 'b', header: 'Bank', render: (p) => `${p.bankName} ••${p.accountLast4}` },
          { key: 's', header: 'Status', render: (p) => <span><ToneBadge value={p.status} />{p.failureReason ? <div className="small muted">{p.failureReason}</div> : null}</span> },
          { key: 'd', header: 'Requested', render: (p) => formatDateTime(p.createdAt) },
          { key: 'x', header: '', render: (p) => (p.status === 'REQUESTED' && can('payouts.approve') ? <span className="row"><ConfirmAction trigger="Approve" needPassword title={`Approve ${formatMoney(p.amount)} to ${p.verifier}`} onConfirm={async ({ reason, password }) => { await api.post(`/admin/finance/payouts/${p.id}/decision`, { decision: 'APPROVE', reason, confirmPassword: password }); toast('Payout approved and sent to the provider'); await payouts.reload(); }} /><ConfirmAction trigger="Reject" variant="secondary" needPassword title="Reject payout (funds return to the verifier)" onConfirm={async ({ reason, password }) => { await api.post(`/admin/finance/payouts/${p.id}/decision`, { decision: 'REJECT', reason, confirmPassword: password }); await payouts.reload(); }} /></span> : null) },
        ]} />}
      </Card>
      <Card title="Payments (individual purchases & institutional top-ups)">
        {payments.loading ? <Spinner /> : <>
          <DataTable rows={payments.data!.items} rowKey={(p) => p.id} columns={[
            { key: 'r', header: 'Reference', render: (p) => <span className="mono small">{p.reference}</span> },
            { key: 'p', header: 'Purpose', render: (p) => humanize(p.purpose) },
            { key: 'o', header: 'Payer', render: (p) => p.organisation ?? 'Individual' },
            { key: 'a', header: 'Amount', render: (p) => formatMoney(p.amount) },
            { key: 's', header: 'Status', render: (p) => <span className="row"><ToneBadge value={p.status} />{p.reconciledAt ? <Badge tone="success">Reconciled</Badge> : null}</span> },
            { key: 'v', header: 'Provider', render: (p) => p.provider },
            { key: 'd', header: 'Created', render: (p) => formatDateTime(p.createdAt) },
            { key: 'x', header: '', render: (p) => (p.status === 'SUCCEEDED' && can('finance.manage') ? <ConfirmAction trigger="Refund" variant="secondary" needPassword title={`Refund ${formatMoney(p.amount)}`} onConfirm={async ({ reason, password }) => { await api.post(`/admin/finance/payments/${p.id}/refund`, { reason, confirmPassword: password }); toast('Refund submitted'); await payments.reload(); }} /> : null) },
          ]} />
          <Pagination page={payments.data!.page} pageSize={payments.data!.pageSize} total={payments.data!.total} onPage={setPage} />
        </>}
      </Card>
      <Card title="Wallets">
        <DataTable rows={wallets.data ?? []} rowKey={(w) => w.id} columns={[{ key: 'o', header: 'Owner', render: (w) => w.owner }, { key: 't', header: 'Type', render: (w) => humanize(w.ownerType) }, { key: 'a', header: 'Available', render: (w) => formatMoney(w.available) }, { key: 'p', header: 'Pending', render: (w) => formatMoney(w.pending) }, { key: 'h', header: 'Held', render: (w) => formatMoney(w.held) }, { key: 'u', header: 'Updated', render: (w) => formatDateTime(w.updatedAt) }]} />
      </Card>
    </>
  );
}
