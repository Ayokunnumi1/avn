'use client';
import { useState } from 'react';
import { Alert, Button, Card, Checkbox, ErrorAlert, KeyValue, PageHeader, SelectInput, Spinner, TextArea, enablePush, formatDateTime, useAction, useApi, useAuth, useToast } from '@avn/ui';
import { api } from '@/lib/api';

interface Session {
  id: string;
  audience: string;
  ipAddress: string | null;
  userAgent: string | null;
  lastSeenAt: string;
  current: boolean;
}

export default function Page() {
  const { me, logout, refresh } = useAuth();
  const toast = useToast();
  const sessions = useApi<Session[]>(api, '/auth/sessions');
  const [prefs, setPrefs] = useState({ email: me?.notificationPrefs.email !== false, sms: me?.notificationPrefs.sms !== false, push: me?.notificationPrefs.push !== false });
  const [dsr, setDsr] = useState({ kind: 'ACCESS', details: '' });
  const savePrefs = useAction(async () => {
    await api.put('/auth/preferences', prefs);
    await refresh();
    toast('Preferences saved');
  });
  const sendDsr = useAction(async () => {
    await api.post('/me/data-requests', dsr);
    toast('Request received. We respond within the NDPA timeframe.');
  });
  if (!me) return <Spinner />;
  return (
    <div className="stack">
      <PageHeader title="Account" />
      <Card title="Profile">
        <KeyValue items={[['Name', me.fullName], ['Phone', me.phone], ['Email', me.email], ['Account', me.isGuest ? 'Guest (institution link)' : 'Permanent']]} />
      </Card>
      <Card title="Notifications">
        <div className="stack-sm">
          <Checkbox label="SMS" checked={prefs.sms} onChange={(v) => setPrefs({ ...prefs, sms: v })} />
          <Checkbox label="Email" checked={prefs.email} onChange={(v) => setPrefs({ ...prefs, email: v })} />
          <Checkbox label="Push notifications on this device" checked={prefs.push} onChange={(v) => setPrefs({ ...prefs, push: v })} />
          <div className="row">
            <Button loading={savePrefs.pending} onClick={() => void savePrefs.run()}>Save</Button>
            <Button variant="secondary" onClick={async () => toast(`Push: ${await enablePush(api)}`)}>Enable push on this device</Button>
          </div>
        </div>
      </Card>
      <Card title="Active sessions" actions={<Button variant="secondary" size="sm" onClick={async () => { await api.post('/auth/logout-all'); window.location.href = '/sign-in'; }}>Sign out everywhere</Button>}>
        {sessions.data?.map((s) => (
          <div key={s.id} className="row between small" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <span>{s.userAgent?.slice(0, 60) ?? 'Unknown device'}{s.current ? ' (this device)' : ''}</span>
            <span className="muted">{formatDateTime(s.lastSeenAt)}</span>
            {!s.current ? <Button variant="ghost" size="sm" onClick={async () => { await api.del(`/auth/sessions/${s.id}`); await sessions.reload(); }}>Revoke</Button> : null}
          </div>
        ))}
      </Card>
      <Card title="Your data (NDPA 2023)">
        <div className="stack">
          <Alert tone="info">Request a copy, correction or deletion of your personal data. Deletion is subject to lawful retention requirements.</Alert>
          <SelectInput label="Request type" value={dsr.kind} onChange={(e) => setDsr({ ...dsr, kind: e.target.value })} options={[{ value: 'ACCESS', label: 'Access my data' }, { value: 'CORRECTION', label: 'Correct my data' }, { value: 'DELETION', label: 'Delete my data' }]} />
          <TextArea label="Details (optional)" value={dsr.details} onChange={(e) => setDsr({ ...dsr, details: e.target.value })} />
          <ErrorAlert error={sendDsr.error} />
          <Button variant="secondary" loading={sendDsr.pending} onClick={() => void sendDsr.run()}>Submit request</Button>
        </div>
      </Card>
      <Button variant="ghost" onClick={() => void logout()}>Sign out</Button>
    </div>
  );
}
