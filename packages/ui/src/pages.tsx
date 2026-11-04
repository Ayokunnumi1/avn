'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, type ApiClient } from './api';
import { useAuth } from './auth';
import { Alert, Button, Card, EmptyState, ErrorAlert, Spinner, TextInput, formatDateTime } from './components';
import { useApi } from './hooks';

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-card stack">
        <div className="brand" style={{ justifyContent: 'center', padding: 0 }}>
          <span className="brand-mark">AVN</span>
        </div>
        <Card>
          <h1 style={{ fontSize: '1.35rem' }}>{title}</h1>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
          {children}
        </Card>
        {footer ? <div className="small muted" style={{ textAlign: 'center' }}>{footer}</div> : null}
      </div>
    </main>
  );
}

function useNext(fallback: string) {
  const sp = useSearchParams();
  const next = sp.get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

/** Email/password sign-in with TOTP step-up when the account has MFA enabled. */
export function PasswordSignIn({ client, after = '/dashboard', title = 'Sign in', footer, demoHint }: { client: ApiClient; after?: string; title?: string; footer?: ReactNode; demoHint?: ReactNode }) {
  return (
    <Suspense fallback={<Spinner />}>
      <PasswordSignInInner client={client} after={after} title={title} footer={footer} demoHint={demoHint} />
    </Suspense>
  );
}
function PasswordSignInInner({ client, after, title, footer, demoHint }: { client: ApiClient; after: string; title: string; footer?: ReactNode; demoHint?: ReactNode }) {
  const router = useRouter();
  const next = useNext(after);
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needMfa, setNeedMfa] = useState(false);
  const [error, setError] = useState<ApiError>();
  const [pending, setPending] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      await client.post('/auth/login', { email, password, ...(needMfa ? { totp } : {}) });
      await refresh();
      router.replace(next);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MFA_REQUIRED') setNeedMfa(true);
      else setError(err as ApiError);
    } finally {
      setPending(false);
    }
  }
  return (
    <AuthLayout title={title} subtitle={needMfa ? 'Enter the 6-digit code from your authenticator app.' : undefined} footer={footer}>
      <form className="stack" onSubmit={submit} noValidate>
        <ErrorAlert error={error} />
        {!needMfa ? (
          <>
            <TextInput label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <TextInput label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </>
        ) : (
          <TextInput label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" className="input otp-input" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} required />
        )}
        <Button type="submit" block size="lg" loading={pending}>
          {needMfa ? 'Verify and sign in' : 'Sign in'}
        </Button>
        <div className="row between small">
          <Link href="/forgot-password">Forgot password?</Link>
        </div>
        {demoHint ? <div className="small muted">{demoHint}</div> : null}
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage({ client }: { client: ApiClient }) {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<{ devLink?: string } | null>(null);
  const [error, setError] = useState<ApiError>();
  const [pending, setPending] = useState(false);
  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link that is valid for 30 minutes." footer={<Link href="/sign-in">Back to sign in</Link>}>
      {done ? (
        <div className="stack">
          <Alert tone="success">If an account exists for {email}, a reset link is on its way.</Alert>
          {done.devLink ? (
            <Alert tone="warning" title="Development simulator">
              Email is not sent in development. <a href={done.devLink}>Open the reset link</a>
            </Alert>
          ) : null}
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            try {
              setDone(await client.post('/auth/password/forgot', { email }));
            } catch (err) {
              setError(err as ApiError);
            } finally {
              setPending(false);
            }
          }}
        >
          <ErrorAlert error={error} />
          <TextInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Button type="submit" block loading={pending}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage({ client }: { client: ApiClient }) {
  return (
    <Suspense fallback={<Spinner />}>
      <ResetInner client={client} />
    </Suspense>
  );
}
function ResetInner({ client }: { client: ApiClient }) {
  const sp = useSearchParams();
  const token = sp.get('token') ?? '';
  const welcome = sp.get('welcome');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<ApiError>();
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);
  const fe = error?.fieldErrors() ?? {};
  return (
    <AuthLayout title={welcome ? 'Set your password' : 'Choose a new password'} subtitle="Use at least 10 characters with upper- and lower-case letters and a number.">
      {ok ? (
        <div className="stack">
          <Alert tone="success">Password updated. All other sessions were signed out.</Alert>
          <Link className="btn btn-primary" href="/sign-in">
            Sign in
          </Link>
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (password !== confirm) return setError(new ApiError(400, 'MISMATCH', 'Passwords do not match'));
            setPending(true);
            try {
              await client.post('/auth/password/reset', { token, password });
              setOk(true);
            } catch (err) {
              setError(err as ApiError);
            } finally {
              setPending(false);
            }
          }}
        >
          <ErrorAlert error={error} />
          <TextInput label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fe.password} required />
          <TextInput label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          <Button type="submit" block loading={pending}>
            Save password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

interface NotificationList {
  unread: number;
  items: Array<{ id: string; title: string; body: string; readAt: string | null; createdAt: string; data?: { requestId?: string } | null }>;
}
export function NotificationsView({ client, linkFor }: { client: ApiClient; linkFor?: (n: NotificationList['items'][number]) => string | null }) {
  const q = useApi<NotificationList>(client, '/notifications', { pollMs: 20000 });
  if (q.loading) return <Spinner />;
  return (
    <Card
      title={`Notifications${q.data?.unread ? ` (${q.data.unread} unread)` : ''}`}
      actions={
        q.data?.unread ? (
          <Button variant="secondary" size="sm" onClick={async () => { await client.post('/notifications/read-all'); await q.reload(); }}>
            Mark all read
          </Button>
        ) : null
      }
    >
      {!q.data?.items.length ? (
        <EmptyState title="No notifications yet" icon="bell" />
      ) : (
        <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {q.data.items.map((n) => {
            const href = linkFor?.(n);
            return (
              <li key={n.id} className="card" style={{ padding: 14, background: n.readAt ? 'var(--surface)' : 'var(--primary-soft)' }}>
                <div className="row between">
                  <strong>{n.title}</strong>
                  <span className="small muted">{formatDateTime(n.createdAt)}</span>
                </div>
                <div className="small">{n.body}</div>
                <div className="row" style={{ marginTop: 6 }}>
                  {href ? <Link className="small" href={href}>Open</Link> : null}
                  {!n.readAt ? (
                    <button className="btn btn-ghost btn-sm" onClick={async () => { await client.post(`/notifications/${n.id}/read`); await q.reload(); }}>
                      Mark read
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
