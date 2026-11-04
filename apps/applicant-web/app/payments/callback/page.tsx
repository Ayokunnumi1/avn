'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Alert, AuthLayout, Spinner } from '@avn/ui';
import { api } from '@/lib/api';

/** After checkout we ask OUR server to verify the payment with the provider — the redirect itself proves nothing. */
function Inner() {
  const sp = useSearchParams();
  const ref = sp.get('reference') ?? sp.get('trxref');
  const [state, setState] = useState<{ status: string; requestId: string | null; failureReason: string | null } | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!ref) return;
    const t = setTimeout(async () => {
      try {
        const r = await api.get<{ status: string; requestId: string | null; failureReason: string | null }>(`/payments/${ref}/status`);
        setState(r);
        if (r.status === 'INITIATED' && tries < 10) setTries((x) => x + 1);
      } catch {
        if (tries < 10) setTries((x) => x + 1);
      }
    }, tries === 0 ? 0 : 2000);
    return () => clearTimeout(t);
  }, [ref, tries]);
  return (
    <AuthLayout title="Payment">
      {!state || state.status === 'INITIATED' ? (
        <Spinner label="Confirming your payment with the provider" />
      ) : state.status === 'SUCCEEDED' ? (
        <div className="stack">
          <Alert tone="success" title="Payment confirmed">Your verification is now being matched with a nearby verifier.</Alert>
          {state.requestId ? <Link className="btn btn-primary" href={`/verifications/${state.requestId}`}>Track verification</Link> : null}
        </div>
      ) : (
        <div className="stack">
          <Alert tone="danger" title="Payment not completed">{state.failureReason ?? 'The payment did not go through.'}</Alert>
          {state.requestId ? <Link className="btn btn-secondary" href={`/verifications/${state.requestId}`}>Try again</Link> : null}
        </div>
      )}
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
