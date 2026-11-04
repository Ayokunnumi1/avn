'use client';
import { useState } from 'react';
import { Alert, Badge, Button, Card, ErrorAlert, KeyValue, PageHeader, SelectInput, Spinner, Stat, TextInput, enablePush, humanize, useAction, useApi, useAuth, useToast } from '@avn/ui';
import { api } from '@/lib/api';
import { CameraCapture, type Capture } from '@/components/camera';

interface Me {
  status: string;
  decisionReason: string | null;
  identity: { status: string; provider: string; at: string } | null;
  onboarding: { photo: boolean; identity: boolean; payoutAccount: boolean };
  payoutAccount: { bankName: string; last4: string; accountName: string } | null;
}
interface Perf {
  completedAssignments: number;
  onTimeRate: number | null;
  releasedAssignments: number;
  evidenceQuality: string | null;
  audit: { passed: number; failed: number; confirmedFraud: number };
  reliabilityScore: string;
  reliabilityLevel: string;
  standing: string;
  note: string;
}

export default function Profile() {
  const toast = useToast();
  const { me, logout } = useAuth();
  const q = useApi<Me>(api, '/verifiers/me');
  const perf = useApi<Perf>(api, '/verifiers/me/performance');
  const banks = useApi<Array<{ name: string; code: string }>>(api, '/verifiers/banks');
  const [idType, setIdType] = useState('NIN');
  const [idNumber, setIdNumber] = useState('');
  const [idDoc, setIdDoc] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<Capture | null>(null);
  const [acct, setAcct] = useState({ bankCode: '', accountNumber: '', accountName: '' });

  const photo = useAction(async (c: Capture) => {
    const f = new FormData();
    f.append('file', c.blob, 'photo.jpg');
    await api.upload('/verifiers/me/photo', f);
    toast('Profile photo saved');
    await q.reload();
  });
  const identity = useAction(async () => {
    const f = new FormData();
    f.append('idType', idType);
    f.append('idNumber', idNumber);
    if (idDoc) f.append('files', idDoc);
    if (selfie) f.append('files', selfie.blob, 'selfie.jpg');
    const r = await api.upload<{ status: string; identityResult: string }>('/verifiers/me/identity', f);
    toast(`Identity submitted — ${humanize(r.status)}`);
    await q.reload();
  });
  const payout = useAction(async () => {
    const bank = banks.data?.find((b) => b.code === acct.bankCode);
    await api.put('/verifiers/me/payout-account', { ...acct, bankName: bank?.name ?? acct.bankCode });
    toast('Payout account saved');
    await q.reload();
  });

  if (q.loading) return <Spinner />;
  const v = q.data!;
  return (
    <div className="stack">
      <PageHeader title="Profile & onboarding" subtitle={me?.fullName} />
      <Card title="Account status" actions={<Badge tone={v.status === 'APPROVED' ? 'success' : v.status === 'SUSPENDED' || v.status === 'REJECTED' ? 'danger' : 'warning'}>{humanize(v.status)}</Badge>}>
        <div className="stack-sm">
          {['Incomplete registration', 'Identity verification pending', 'Manual review', 'Approved'].map((label, i) => {
            const order = ['INCOMPLETE', 'IDENTITY_PENDING', 'MANUAL_REVIEW', 'APPROVED'];
            const reached = order.indexOf(v.status) >= i;
            return (
              <div key={label} className="row small">
                <Badge tone={reached ? 'success' : undefined}>{reached ? 'Done' : 'Pending'}</Badge> {label}
              </div>
            );
          })}
          {v.decisionReason ? <Alert tone="info">{v.decisionReason}</Alert> : null}
        </div>
      </Card>
      <Card title="1. Profile photograph" actions={v.onboarding.photo ? <Badge tone="success">Saved</Badge> : null}>
        <CameraCapture label={v.onboarding.photo ? 'Retake photo' : 'Take profile photo'} onCapture={(c) => void photo.run(c)} />
        <ErrorAlert error={photo.error} />
      </Card>
      <Card title="2. Identity verification" actions={v.identity ? <Badge tone={v.identity.status === 'PASSED' ? 'success' : v.identity.status === 'FAILED' ? 'danger' : 'warning'}>{humanize(v.identity.status)}</Badge> : null}>
        {v.status === 'APPROVED' ? (
          <Alert tone="success">Your identity is verified.</Alert>
        ) : (
          <div className="stack">
            {v.identity?.provider === 'simulator' ? <span className="dev-label">Development identity simulator — not a real check</span> : null}
            <SelectInput label="ID type" value={idType} onChange={(e) => setIdType(e.target.value)} options={['NIN', 'BVN', 'VOTERS_CARD', 'DRIVERS_LICENCE', 'INTL_PASSPORT'].map((t) => ({ value: t, label: humanize(t) }))} />
            <TextInput label="ID number" value={idNumber} onChange={(e) => setIdNumber(e.target.value.toUpperCase())} required />
            <div className="field">
              <label htmlFor="iddoc">Photo of your ID document</label>
              <input id="iddoc" className="input" type="file" accept="image/*,application/pdf" onChange={(e) => setIdDoc(e.target.files?.[0] ?? null)} />
            </div>
            <div className="field">
              <span className="label">Selfie (liveness)</span>
              {selfie ? <Alert tone="success">Selfie captured</Alert> : <CameraCapture label="Take selfie" onCapture={setSelfie} />}
            </div>
            <ErrorAlert error={identity.error} />
            <Button loading={identity.pending} disabled={!idNumber || !idDoc} onClick={() => void identity.run()}>
              Submit for verification
            </Button>
          </div>
        )}
      </Card>
      <Card title="3. Payout account (Nigerian bank)" actions={v.payoutAccount ? <Badge tone="success">Saved</Badge> : null}>
        <div className="stack">
          {v.payoutAccount ? <KeyValue items={[['Bank', v.payoutAccount.bankName], ['Account', `•••• ${v.payoutAccount.last4}`], ['Name', v.payoutAccount.accountName]]} /> : null}
          <SelectInput label="Bank" value={acct.bankCode} onChange={(e) => setAcct({ ...acct, bankCode: e.target.value })} options={[{ value: '', label: 'Select bank' }, ...(banks.data ?? []).map((b) => ({ value: b.code, label: b.name }))]} />
          <TextInput label="Account number (NUBAN)" inputMode="numeric" maxLength={10} value={acct.accountNumber} onChange={(e) => setAcct({ ...acct, accountNumber: e.target.value.replace(/\D/g, '') })} />
          <TextInput label="Account name" value={acct.accountName} onChange={(e) => setAcct({ ...acct, accountName: e.target.value })} />
          <ErrorAlert error={payout.error} />
          <Button variant="secondary" loading={payout.pending} disabled={!acct.bankCode || acct.accountNumber.length !== 10 || !acct.accountName} onClick={() => void payout.run()}>
            Save payout account
          </Button>
        </div>
      </Card>
      {perf.data ? (
        <Card title="Performance">
          <div className="grid grid-2">
            <Stat label="Completed visits" value={perf.data.completedAssignments} />
            <Stat label="On-time" value={perf.data.onTimeRate != null ? `${perf.data.onTimeRate}%` : '—'} />
            <Stat label="Reliability" value={perf.data.reliabilityScore} hint={humanize(perf.data.reliabilityLevel)} />
            <Stat label="Audit results" value={`${perf.data.audit.passed} passed`} hint={`${perf.data.audit.failed} failed`} />
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>{perf.data.note}</p>
        </Card>
      ) : null}
      <div className="row">
        <Button variant="secondary" onClick={async () => toast(`Push: ${await enablePush(api)}`)}>Enable job alerts on this phone</Button>
        <Button variant="ghost" onClick={() => void logout()}>Sign out</Button>
      </div>
    </div>
  );
}
