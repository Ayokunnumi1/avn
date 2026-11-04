'use client';
import { useState } from 'react';
import type { ApiClient } from './api';
import { useAuth } from './auth';
import { Alert, Badge, Button, Card, ErrorAlert, KeyValue, PageHeader, TextInput, formatDateTime } from './components';
import { useAction, useApi } from './hooks';

interface Session { id: string; userAgent: string | null; ipAddress: string | null; lastSeenAt: string; current: boolean }

/** MFA enrolment (TOTP) and session management, shared by the Business and Admin apps. */
export function SecuritySettings({ client }: { client: ApiClient }) {
  const { me, refresh } = useAuth();
  const sessions = useApi<Session[]>(client, '/auth/sessions');
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const begin = useAction(async () => setSetup(await client.post('/auth/mfa/setup')));
  const enable = useAction(async () => {
    await client.post('/auth/mfa/enable', { code });
    setSetup(null);
    setCode('');
    await refresh();
  });
  const disable = useAction(async () => {
    await client.post('/auth/mfa/disable', { code });
    setCode('');
    await refresh();
  });
  return (
    <div className="stack">
      <PageHeader title="Security" />
      <Card title="Two-factor authentication" actions={me?.mfaEnabled ? <Badge tone="success">Enabled</Badge> : <Badge tone="warning">Off</Badge>}>
        {me?.mfaEnabled ? (
          <div className="stack">
            <p className="muted">Sign-ins require a code from your authenticator app.</p>
            {me.accountType !== 'ADMIN' ? (
              <div className="row">
                <TextInput label="Current code to disable" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                <Button variant="secondary" loading={disable.pending} onClick={() => void disable.run()} style={{ alignSelf: 'flex-end' }}>Disable MFA</Button>
              </div>
            ) : <Alert tone="info">MFA cannot be disabled for administrators.</Alert>}
            <ErrorAlert error={disable.error} />
          </div>
        ) : setup ? (
          <div className="stack">
            <Alert tone="info">Add this account to Google Authenticator, Microsoft Authenticator or 1Password using the key below (or the otpauth link), then enter the 6-digit code.</Alert>
            <KeyValue items={[['Secret key', <span className="mono" key="s">{setup.secret.match(/.{1,4}/g)?.join(' ')}</span>], ['Setup link', <a key="l" href={setup.otpauthUrl}>Open in authenticator</a>]]} />
            <TextInput label="6-digit code" inputMode="numeric" className="input otp-input" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <ErrorAlert error={enable.error} />
            <Button loading={enable.pending} disabled={code.length !== 6} onClick={() => void enable.run()}>Enable MFA</Button>
          </div>
        ) : (
          <Button loading={begin.pending} onClick={() => void begin.run()}>Set up authenticator app</Button>
        )}
      </Card>
      <Card title="Active sessions" actions={<Button variant="secondary" size="sm" onClick={async () => { await client.post('/auth/logout-all'); window.location.href = '/sign-in'; }}>Sign out everywhere</Button>}>
        {sessions.data?.map((s) => (
          <div key={s.id} className="row between small" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <span>{s.userAgent?.slice(0, 70) ?? 'Unknown'}{s.current ? ' (this session)' : ''}</span>
            <span className="muted">{s.ipAddress} · {formatDateTime(s.lastSeenAt)}</span>
            {!s.current ? <Button variant="ghost" size="sm" onClick={async () => { await client.del(`/auth/sessions/${s.id}`); await sessions.reload(); }}>Revoke</Button> : null}
          </div>
        ))}
      </Card>
    </div>
  );
}
