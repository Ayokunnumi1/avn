'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Alert, AuthLayout, Badge, Button, KeyValue, Spinner, TextInput, formatDateTime } from '@avn/ui';
import { api } from '@/lib/api';

interface Result {
  reference: string;
  valid: boolean;
  status: string;
  issuedAt?: string;
  validUntil?: string;
  issuer?: string;
  outcomeLabel?: string;
  note?: string;
}

function Inner() {
  const sp = useSearchParams();
  const [ref, setRef] = useState(sp.get('ref') ?? '');
  const [hash, setHash] = useState(sp.get('h') ?? '');
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      setRes(await api.get<Result>(`/reports/verify/${encodeURIComponent(ref.trim().toUpperCase())}${hash ? `?h=${encodeURIComponent(hash.trim().toLowerCase())}` : ''}`));
    } catch {
      setRes({ reference: ref, valid: false, status: 'NOT_FOUND' });
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (sp.get('ref')) void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <AuthLayout title="Check a verification report" subtitle="Enter the reference printed on the report. Add the content hash to also confirm its outcome." footer={<Link href="/">AVN home</Link>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void check(); }}>
        <TextInput label="Report reference" placeholder="AVN-RPT-XXXXXXXX" value={ref} onChange={(e) => setRef(e.target.value)} required />
        <TextInput label="Content hash (optional, first 16+ characters)" className="input mono" value={hash} onChange={(e) => setHash(e.target.value)} />
        <Button type="submit" loading={busy}>Check report</Button>
        {res ? (
          res.valid ? (
            <Alert tone="success" title="Authentic and current">
              <KeyValue items={[['Reference', res.reference], ['Issued', formatDateTime(res.issuedAt)], ['Valid until', formatDateTime(res.validUntil)], ['Outcome', res.outcomeLabel ? <Badge tone="primary">{res.outcomeLabel}</Badge> : res.note]]} />
            </Alert>
          ) : (
            <Alert tone={res.status === 'SUPERSEDED' || res.status === 'EXPIRED' ? 'warning' : 'danger'} title={res.status === 'NOT_FOUND' ? 'No report found' : `Report ${res.status.toLowerCase()}`}>
              {res.status === 'SUPERSEDED' ? 'A newer version of this report exists.' : res.status === 'EXPIRED' ? 'This report is past its validity period.' : res.status === 'TAMPERED' ? 'Signature check failed. Do not rely on this report.' : 'Check the reference and try again.'}
            </Alert>
          )
        ) : null}
      </form>
    </AuthLayout>
  );
}
export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <Inner />
    </Suspense>
  );
}
