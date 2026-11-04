'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, ApiError, AuthLayout, Button, ErrorAlert, KeyValue, Spinner, TextInput, humanize, useAuth } from '@avn/ui';
import { api } from '@/lib/api';

interface Invitation {
  organisation: string;
  applicantName: string;
  phoneMasked: string;
  status: string;
  requestStatus: string;
  level: string;
  purpose: string;
  expiresAt: string;
}

/** Institution links work without a permanent account: possession of the link + an OTP to the phone on file. */
export default function Page() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { refresh } = useAuth();
  const [inv, setInv] = useState<Invitation>();
  const [error, setError] = useState<ApiError>();
  const [sent, setSent] = useState<{ devCode?: string } | null>(null);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    api.get<Invitation>(`/invitations/${token}`).then(setInv, (e) => setError(e as ApiError));
  }, [token]);
  if (error && !inv) return <AuthLayout title="Invitation unavailable"><ErrorAlert error={error} /></AuthLayout>;
  if (!inv) return <Spinner />;
  return (
    <AuthLayout title={`${inv.organisation} requests an address verification`} subtitle="Confirm it's you to continue. You don't need to create an account.">
      <div className="stack">
        <KeyValue items={[['For', inv.applicantName], ['Purpose', humanize(inv.purpose)], ['Level', inv.level], ['Phone on file', inv.phoneMasked]]} />
        <ErrorAlert error={error} />
        {!sent ? (
          <Button
            block
            size="lg"
            loading={pending}
            onClick={async () => {
              setPending(true);
              try {
                setSent(await api.post(`/invitations/${token}/otp`));
              } catch (e) {
                setError(e as ApiError);
              } finally {
                setPending(false);
              }
            }}
          >
            Text me a code
          </Button>
        ) : (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              try {
                const r = await api.post<{ requestId: string }>(`/invitations/${token}/verify`, { code });
                await refresh();
                router.replace(`/verifications/${r.requestId}`);
              } catch (err) {
                setError(err as ApiError);
              } finally {
                setPending(false);
              }
            }}
          >
            {sent.devCode ? (
              <Alert tone="warning" title="Development simulator">
                SMS is not sent in development. Code: <strong className="mono">{sent.devCode}</strong>
              </Alert>
            ) : null}
            <TextInput label="6-digit code" inputMode="numeric" className="input otp-input" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
            <Button type="submit" block size="lg" loading={pending}>
              Continue
            </Button>
          </form>
        )}
      </div>
    </AuthLayout>
  );
}
