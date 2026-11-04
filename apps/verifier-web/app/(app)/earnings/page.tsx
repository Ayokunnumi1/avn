'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Button, Card, DataTable, ErrorAlert, PageHeader, Spinner, Stat, TextInput, formatDateTime, formatMoney, humanize, newIdempotencyKey, useAction, useApi, useToast } from '@avn/ui';
import { api } from '@/lib/api';

interface Earnings {
  pending: string;
  available: string;
  held: string;
  currency: string;
  minimumPayout: number;
  transactions: Array<{ id: string; direction: string; bucket: string; category: string; amount: string; description: string; createdAt: string }>;
  payouts: Array<{ id: string; reference: string; amount: string; status: string; bankName: string; accountLast4: string; createdAt: string; failureReason: string | null; rejectionReason: string | null }>;
}

export default function Page() {
  const toast = useToast();
  const q = useApi<Earnings>(api, '/verifiers/me/earnings');
  const [amount, setAmount] = useState('');
  const [key, setKey] = useState(newIdempotencyKey());
  const withdraw = useAction(async () => {
    await api.post('/verifiers/me/payouts', { amount, idempotencyKey: key });
    toast('Withdrawal requested. Funds are held until finance approves.');
    setAmount('');
    setKey(newIdempotencyKey());
    await q.reload();
  });
  if (q.loading) return <Spinner />;
  const e = q.data!;
  return (
    <div className="stack">
      <PageHeader title="Earnings" subtitle="Credited by the server when a visit is processed — never from app events alone." />
      <div className="grid grid-3">
        <Stat label="Pending (awaiting approval)" value={formatMoney(e.pending, e.currency)} />
        <Stat label="Withdrawable" value={formatMoney(e.available, e.currency)} />
        <Stat label="Held for withdrawal" value={formatMoney(e.held, e.currency)} />
      </div>
      <Card title="Withdraw to bank">
        <form className="stack" onSubmit={(ev) => { ev.preventDefault(); void withdraw.run(); }}>
          <ErrorAlert error={withdraw.error} />
          <TextInput label={`Amount (minimum ${formatMoney(e.minimumPayout, e.currency)})`} inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value.replace(/[^\d.]/g, ''))} required />
          <div className="row">
            <Button type="submit" loading={withdraw.pending} disabled={!amount}>Request withdrawal</Button>
            <Link href="/profile" className="small">Change payout account</Link>
          </div>
        </form>
      </Card>
      <Card title="Withdrawals">
        <DataTable rows={e.payouts} rowKey={(p) => p.id} empty="No withdrawals yet"
          columns={[
            { key: 'ref', header: 'Reference', render: (p) => <span className="mono small">{p.reference}</span> },
            { key: 'amt', header: 'Amount', render: (p) => formatMoney(p.amount, e.currency) },
            { key: 'st', header: 'Status', render: (p) => <Badge tone={p.status === 'COMPLETED' ? 'success' : p.status === 'FAILED' || p.status === 'REJECTED' ? 'danger' : 'warning'}>{humanize(p.status)}</Badge> },
            { key: 'bank', header: 'To', render: (p) => `${p.bankName} •••${p.accountLast4}` },
            { key: 'at', header: 'Requested', render: (p) => formatDateTime(p.createdAt) },
          ]} />
        {e.payouts.some((p) => p.failureReason) ? <Alert tone="warning">Failed transfers are returned to your withdrawable balance automatically.</Alert> : null}
      </Card>
      <Card title="Ledger">
        <DataTable rows={e.transactions} rowKey={(t) => t.id} empty="No transactions yet"
          columns={[
            { key: 'at', header: 'Date', render: (t) => formatDateTime(t.createdAt) },
            { key: 'd', header: 'Description', render: (t) => t.description },
            { key: 'b', header: 'Balance', render: (t) => humanize(t.bucket) },
            { key: 'a', header: 'Amount', render: (t) => <span style={{ color: t.direction === 'CREDIT' ? 'var(--success)' : 'var(--text)' }}>{t.direction === 'CREDIT' ? '+' : '−'}{formatMoney(t.amount, e.currency)}</span> },
          ]} />
      </Card>
    </div>
  );
}
