'use client';
import Link from 'next/link';
import { useState } from 'react';
import { PRIORITIES, VERIFICATION_PURPOSES } from '@avn/contracts';
import { Alert, Button, Card, ErrorAlert, KeyValue, PageHeader, SelectInput, TextArea, TextInput, Checkbox, formatDateTime, humanize, useAction, useApi, useToast } from '@avn/ui';
import { api } from '@/lib/api';

interface Policy { id: string; name: string; isDefault: boolean; currentVersion: number }

export default function Page() {
  const toast = useToast();
  const policies = useApi<Policy[]>(api, '/org/policies');
  const [f, setF] = useState({ applicantName: '', applicantPhone: '', applicantEmail: '', customerReference: '', level: 'STANDARD', purpose: 'BANK_ACCOUNT', priority: 'NORMAL', policyId: '', deadline: '', instructions: '', department: '', sendInvitation: true });
  const [created, setCreated] = useState<{ id: string; reference: string; invitationUrl: string; invitationExpiresAt: string } | null>(null);
  const create = useAction(async () => {
    const body = { ...f, applicantEmail: f.applicantEmail || undefined, policyId: f.policyId || undefined, deadline: f.deadline ? new Date(f.deadline).toISOString() : undefined, instructions: f.instructions || undefined, department: f.department || undefined };
    setCreated(await api.post('/org/requests', body));
  });
  const fe = create.error?.fieldErrors() ?? {};
  if (created) {
    return (
      <>
        <PageHeader title="Verification created" />
        <Card>
          <div className="stack">
            <Alert tone="success" title={created.reference}>{f.sendInvitation ? 'The applicant has been sent a secure link by SMS' + (f.applicantEmail ? ' and email.' : '.') : 'Share the secure link with the applicant.'}</Alert>
            <KeyValue items={[['Secure invitation link', <input key="l" className="input mono" readOnly value={created.invitationUrl} onFocus={(e) => e.target.select()} />], ['Link expires', formatDateTime(created.invitationExpiresAt)]]} />
            <div className="row">
              <Button onClick={async () => { await navigator.clipboard.writeText(created.invitationUrl); toast('Link copied'); }}>Copy link</Button>
              <Link className="btn btn-secondary" href={`/requests/${created.id}`}>Open request</Link>
              <Button variant="ghost" onClick={() => { setCreated(null); setF({ ...f, applicantName: '', applicantPhone: '', applicantEmail: '', customerReference: '' }); }}>Create another</Button>
            </div>
            <p className="small muted">For security the full link is shown only now. You can regenerate a new link from the request page.</p>
          </div>
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHeader title="New verification request" subtitle="The applicant completes their address and map pin through a secure link." />
      <Card>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void create.run(); }}>
          <ErrorAlert error={create.error && !Object.keys(fe).length ? create.error : undefined} />
          <div className="grid grid-2">
            <TextInput label="Applicant full name" value={f.applicantName} onChange={(e) => setF({ ...f, applicantName: e.target.value })} error={fe.applicantName} required />
            <TextInput label="Applicant phone" type="tel" value={f.applicantPhone} onChange={(e) => setF({ ...f, applicantPhone: e.target.value })} error={fe.applicantPhone} required />
            <TextInput label="Applicant email (optional)" type="email" value={f.applicantEmail} onChange={(e) => setF({ ...f, applicantEmail: e.target.value })} error={fe.applicantEmail} />
            <TextInput label="Customer reference" value={f.customerReference} onChange={(e) => setF({ ...f, customerReference: e.target.value })} error={fe.customerReference} hint="Your internal ID — must be unique among active requests." required />
            <SelectInput label="Verification type" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} options={['BASIC', 'STANDARD', 'ENHANCED'].map((l) => ({ value: l, label: humanize(l) }))} />
            <SelectInput label="Verification policy" value={f.policyId} onChange={(e) => setF({ ...f, policyId: e.target.value })} options={[{ value: '', label: 'Organisation default' }, ...(policies.data ?? []).map((p) => ({ value: p.id, label: `${p.name} (v${p.currentVersion})${p.isDefault ? ' — default' : ''}` }))]} />
            <SelectInput label="Purpose" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} options={VERIFICATION_PURPOSES.map((p) => ({ value: p, label: humanize(p) }))} />
            <SelectInput label="Priority" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} options={PRIORITIES.map((p) => ({ value: p, label: humanize(p) }))} />
            <TextInput label="Completion deadline (optional)" type="datetime-local" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} hint="Defaults to the policy deadline." />
            <TextInput label="Department (optional)" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} />
          </div>
          <TextArea label="Additional instructions for the verifier (optional)" value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} />
          <Checkbox label="Send the secure link to the applicant now (SMS / email)" checked={f.sendInvitation} onChange={(v) => setF({ ...f, sendInvitation: v })} />
          <p className="small muted">Your prepaid wallet is charged when the request is created and refunded if you cancel before field work begins. Residential address can be completed by the applicant.</p>
          <Button type="submit" size="lg" loading={create.pending}>Create request</Button>
        </form>
      </Card>
    </>
  );
}
