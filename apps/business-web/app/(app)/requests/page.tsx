'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { REQUEST_STATUSES, STATUS_LABELS } from '@avn/contracts';
import { Badge, Button, Card, DataTable, ErrorAlert, PageHeader, Pagination, SelectInput, Spinner, StatusBadge, TextInput, formatDate, humanize, useApi } from '@avn/ui';
import { api } from '@/lib/api';

interface Row {
  id: string;
  reference: string;
  customerReference: string | null;
  applicantName: string;
  status: string;
  outcome: string | null;
  level: string;
  priority: string;
  department: string | null;
  location: string;
  verifierCode: string | null;
  riskFlagged: boolean;
  createdAt: string;
  deadline: string | null;
}
interface Page {
  items: Row[];
  total: number;
  page: number;
  pageSize: number;
}

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [f, setF] = useState({ q: '', status: sp.get('status') ?? '', level: '', from: '', to: '', state: '', city: '', department: '', risk: '' });
  const [applied, setApplied] = useState(f);
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams(Object.entries({ ...applied, page: String(page), pageSize: '20' }).filter(([, v]) => v) as [string, string][]).toString();
  const q = useApi<Page>(api, `/org/requests?${qs}`);
  return (
    <>
      <PageHeader title="Verifications" subtitle="Search and filter every request in your organisation." />
      <Card>
        <form className="grid grid-4" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(f); }}>
          <TextInput label="Search" placeholder="Reference, customer ref, name, phone" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          <SelectInput label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={[{ value: '', label: 'Any status' }, ...REQUEST_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))]} />
          <SelectInput label="Level" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} options={[{ value: '', label: 'Any level' }, ...['BASIC', 'STANDARD', 'ENHANCED'].map((l) => ({ value: l, label: humanize(l) }))]} />
          <SelectInput label="Risk" value={f.risk} onChange={(e) => setF({ ...f, risk: e.target.value })} options={[{ value: '', label: 'Any' }, { value: 'flagged', label: 'Risk flagged' }, { value: 'clear', label: 'No flags' }]} />
          <TextInput label="From" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          <TextInput label="To" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
          <TextInput label="State" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} />
          <TextInput label="City" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
          <TextInput label="Department" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} />
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Button type="submit">Apply filters</Button>
            <Button type="button" variant="ghost" onClick={() => { const empty = { q: '', status: '', level: '', from: '', to: '', state: '', city: '', department: '', risk: '' }; setF(empty); setApplied(empty); }}>Reset</Button>
          </div>
        </form>
      </Card>
      {q.loading ? <Spinner /> : q.error ? <ErrorAlert error={q.error} /> : (
        <>
          <DataTable rows={q.data!.items} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/requests/${r.id}`)} empty="No verifications match these filters"
            columns={[
              { key: 'ref', header: 'Reference', render: (r) => <span className="mono">{r.reference}</span> },
              { key: 'cust', header: 'Customer ref', render: (r) => r.customerReference },
              { key: 'app', header: 'Applicant', render: (r) => r.applicantName },
              { key: 'st', header: 'Status', render: (r) => <span className="row"><StatusBadge status={r.status} />{r.riskFlagged ? <Badge tone="danger">Risk</Badge> : null}</span> },
              { key: 'lvl', header: 'Level', render: (r) => r.level },
              { key: 'loc', header: 'Location', render: (r) => r.location || '—' },
              { key: 'ag', header: 'Agent', render: (r) => <span className="mono small">{r.verifierCode ?? '—'}</span> },
              { key: 'dt', header: 'Created', render: (r) => formatDate(r.createdAt) },
            ]} />
          <Pagination page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
export default function Page() {
  return <Suspense fallback={<Spinner />}><Inner /></Suspense>;
}
