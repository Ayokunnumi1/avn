'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, DataTable, ErrorAlert, KeyValue, PageHeader, Spinner, Stat, TextInput, formatDate, formatDateTime, formatMoney, humanize, useAction, useApi, useAuth } from '@avn/ui';
import { api } from '@/lib/api';

interface Billing { available: string; currency: string; postpaidEnabled: boolean; creditLimit: string; pricing: Array<{ level: string; price: string; bulkThreshold: number; bulkPrice: string | null; slaHours: number }> }
interface Tx { id: string; direction: string; category: string; amount: string; balanceAfter: string; description: string; createdAt: string }
interface Statement { period: string; verificationsCharged: number; charges: string; refunds: string; netUsage: string; topups: string; openingBalance: string; closingBalance: string }
interface Invoice { id: string; number: string; periodStart: string; total: string; status: string }

function Inner() {
  const { can } = useAuth();
  const sp = useSearchParams();
  const ref = sp.get('reference');
  const b = useApi<Billing>(api, '/org/billing');
  const tx = useApi<Tx[]>(api, '/org/billing/transactions');
  const inv = useApi<Invoice[]>(api, '/org/billing/invoices');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const st = useApi<Statement>(api, `/org/billing/statements/${month}`);
  const [amount, setAmount] = useState('50000');
  const [payment, setPayment] = useState<string | null>(null);
  useEffect(() => {
    if (!ref) return;
    void api.get<{ status: string }>(`/payments/${ref}/status`).then((p) => { setPayment(p.status); void b.reload(); void tx.reload(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
  const topup = useAction(async () => {
    const r = await api.post<{ authorizationUrl: string }>('/org/billing/topup', { amount });
    window.location.href = r.authorizationUrl;
  });
  const invoice = useAction(async () => { await api.post(`/org/billing/invoices/${month}`); await inv.reload(); });
  if (b.loading) return <Spinner />;
  if (b.error) return <ErrorAlert error={b.error} />;
  const d = b.data!;
  return (
    <>
      <PageHeader title="Billing" subtitle="Prepaid wallet with usage-based charging. Every balance change is an immutable ledger entry." />
      {payment ? <Alert tone={payment === 'SUCCEEDED' ? 'success' : 'warning'}>Top-up {ref}: {humanize(payment)} (verified with the payment provider)</Alert> : null}
      <div className="grid grid-3">
        <Stat label="Wallet balance" value={formatMoney(d.available, d.currency)} tone={Number(d.available) < 0 ? 'danger' : undefined} />
        <Stat label="Postpaid credit" value={d.postpaidEnabled ? formatMoney(d.creditLimit, d.currency) : 'Not enabled'} hint="Available to approved organisations only" />
        <Stat label={`Usage ${month}`} value={st.data ? formatMoney(st.data.netUsage, d.currency) : '—'} hint={st.data ? `${st.data.verificationsCharged} verifications` : undefined} />
      </div>
      {can('billing.manage') ? (
        <Card title="Top up wallet">
          <form className="row" onSubmit={(e) => { e.preventDefault(); void topup.run(); }}>
            <TextInput label="Amount (NGN)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
            <Button type="submit" loading={topup.pending} style={{ alignSelf: 'flex-end' }}>Pay with Paystack</Button>
          </form>
          <ErrorAlert error={topup.error} />
        </Card>
      ) : null}
      <div className="grid grid-2">
        <Card title="Pricing">
          <DataTable rows={d.pricing} rowKey={(p) => p.level} columns={[{ key: 'l', header: 'Level', render: (p) => p.level }, { key: 'p', header: 'Price', render: (p) => formatMoney(p.price, d.currency) }, { key: 'b', header: 'Bulk price', render: (p) => (p.bulkPrice ? `${formatMoney(p.bulkPrice, d.currency)} after ${p.bulkThreshold}/mo` : '—') }, { key: 's', header: 'SLA', render: (p) => `${p.slaHours} h` }]} />
        </Card>
        <Card title="Monthly statement" actions={<input className="input" type="month" aria-label="Statement month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 170 }} />}>
          {st.data ? <KeyValue items={[['Verifications charged', st.data.verificationsCharged], ['Charges', formatMoney(st.data.charges)], ['Refunds', formatMoney(st.data.refunds)], ['Net usage', formatMoney(st.data.netUsage)], ['Top-ups', formatMoney(st.data.topups)], ['Opening balance', formatMoney(st.data.openingBalance)], ['Closing balance', formatMoney(st.data.closingBalance)]]} /> : <Spinner />}
          {can('billing.manage') ? <div style={{ marginTop: 12 }}><Button variant="secondary" size="sm" loading={invoice.pending} onClick={() => void invoice.run()}>Generate invoice for {month}</Button></div> : null}
        </Card>
      </div>
      <Card title="Invoices">
        <DataTable rows={inv.data ?? []} rowKey={(i) => i.id} empty="No invoices yet" columns={[{ key: 'n', header: 'Number', render: (i) => <span className="mono">{i.number}</span> }, { key: 'p', header: 'Period', render: (i) => formatDate(i.periodStart) }, { key: 't', header: 'Total', render: (i) => formatMoney(i.total) }, { key: 's', header: 'Status', render: (i) => <Badge>{humanize(i.status)}</Badge> }]} />
      </Card>
      <Card title="Transactions">
        <DataTable rows={tx.data ?? []} rowKey={(t) => t.id} empty="No transactions" columns={[
          { key: 'd', header: 'Date', render: (t) => formatDateTime(t.createdAt) },
          { key: 'c', header: 'Type', render: (t) => humanize(t.category) },
          { key: 'x', header: 'Description', render: (t) => t.description },
          { key: 'a', header: 'Amount', render: (t) => <span style={{ color: t.direction === 'CREDIT' ? 'var(--success)' : undefined }}>{t.direction === 'CREDIT' ? '+' : '−'}{formatMoney(t.amount)}</span> },
          { key: 'b', header: 'Balance', render: (t) => formatMoney(t.balanceAfter) },
        ]} />
      </Card>
    </>
  );
}
export default function Page() {
  return <Suspense fallback={<Spinner />}><Inner /></Suspense>;
}
