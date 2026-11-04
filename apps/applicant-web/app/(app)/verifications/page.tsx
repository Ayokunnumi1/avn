'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, DataTable, ErrorAlert, PageHeader, Spinner, StatusBadge, formatDate, useApi, useAuth } from '@avn/ui';
import { api } from '@/lib/api';

interface Row {
  id: string;
  reference: string;
  status: string;
  level: string;
  requestedBy: string;
  address: string;
  createdAt: string;
  needsPayment: boolean;
  needsSubmission: boolean;
}

export default function Page() {
  const router = useRouter();
  const { me } = useAuth();
  const q = useApi<Row[]>(api, '/me/requests');
  return (
    <>
      <PageHeader title="My verifications" actions={!me?.isGuest ? <Link className="btn btn-primary" href="/verifications/new">New verification</Link> : null} />
      {q.loading ? <Spinner /> : q.error ? <ErrorAlert error={q.error} /> : (
        <DataTable
          rows={q.data ?? []}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/verifications/${r.id}`)}
          empty="No verifications yet"
          columns={[
            { key: 'ref', header: 'Reference', render: (r) => <span className="mono">{r.reference}</span> },
            { key: 'by', header: 'Requested by', render: (r) => r.requestedBy },
            { key: 'status', header: 'Status', render: (r) => (r.needsSubmission ? <Badge tone="warning">Your details needed</Badge> : r.needsPayment ? <Badge tone="warning">Payment needed</Badge> : <StatusBadge status={r.status} />) },
            { key: 'addr', header: 'Address', render: (r) => <span className="small">{r.address || '—'}</span> },
            { key: 'date', header: 'Created', render: (r) => formatDate(r.createdAt) },
          ]}
        />
      )}
    </>
  );
}
