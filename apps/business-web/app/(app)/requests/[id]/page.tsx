'use client';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Card, ChecklistPanel, EvidencePanel, ErrorAlert, FindingsPanel, GpsPanel, Modal, ReportsPanel, RequestSummary, RiskPanel, SelectInput, Spinner, TextArea, TextInput, TimelinePanel, humanize, formatDateTime, useAction, useApi, useAuth, useToast, type RequestDetail } from '@avn/ui';
import { api } from '@/lib/api';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const q = useApi<RequestDetail>(api, `/org/requests/${id}`, { pollMs: 20000 });
  const [modal, setModal] = useState<'cancel' | 'dispute' | 'reverify' | null>(null);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [level, setLevel] = useState('STANDARD');
  const [link, setLink] = useState<string>();
  const act = useAction(async (kind: string) => {
    if (kind === 'cancel') await api.post(`/org/requests/${id}/cancel`, { reason });
    if (kind === 'dispute') await api.post(`/org/requests/${id}/disputes`, { reason, details });
    if (kind === 'reverify') {
      const r = await api.post<{ id: string }>(`/org/requests/${id}/reverify`, { level, instructions: details || undefined });
      router.push(`/requests/${r.id}`);
      return;
    }
    if (kind === 'invite') {
      const r = await api.post<{ invitationUrl: string }>(`/org/requests/${id}/invitation`, { send: true });
      setLink(r.invitationUrl);
      toast('A new secure link was generated and sent');
    }
    setModal(null);
    setReason('');
    setDetails('');
    await q.reload();
  });
  if (q.loading) return <Spinner />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const r = q.data!;
  const final = ['COMPLETED', 'PARTIALLY_VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE'].includes(r.status);
  const cancellable = !final && !['ARRIVED', 'VISIT_IN_PROGRESS', 'EVIDENCE_SUBMITTED', 'PROCESSING', 'CANCELLED', 'EXPIRED'].includes(r.status);
  return (
    <div className="stack">
      <RequestSummary
        r={r}
        actions={
          <>
            {r.status === 'AWAITING_APPLICANT' && can('requests.create') ? <Button variant="secondary" loading={act.pending} onClick={() => void act.run('invite')}>Resend secure link</Button> : null}
            {final && can('reports.dispute') ? <Button variant="secondary" onClick={() => setModal('dispute')}>Raise dispute</Button> : null}
            {final && can('requests.create') ? <Button variant="secondary" onClick={() => setModal('reverify')}>Request additional verification</Button> : null}
            {cancellable && can('requests.cancel') ? <Button variant="danger" onClick={() => setModal('cancel')}>Cancel</Button> : null}
          </>
        }
      />
      {link ? <Alert tone="info" title="New invitation link"><input className="input mono" readOnly value={link} onFocus={(e) => e.target.select()} /></Alert> : null}
      <ReportsPanel r={r} audience="business" />
      <FindingsPanel r={r} />
      <GpsPanel r={r} />
      <EvidencePanel r={r} />
      <div className="grid grid-2">
        <ChecklistPanel r={r} />
        <RiskPanel r={r} />
      </div>
      {r.disputes.length ? (
        <Card title="Disputes">
          {r.disputes.map((d) => (
            <div key={d.id} className="small" style={{ marginBottom: 8 }}>
              <strong>{d.reason}</strong> — {humanize(d.status)} · {formatDateTime(d.createdAt)} {d.resolutionNote ? `· ${d.resolutionNote}` : ''}
            </div>
          ))}
        </Card>
      ) : null}
      <TimelinePanel r={r} />
      <Modal open={modal === 'cancel'} onClose={() => setModal(null)} title="Cancel this verification?">
        <div className="stack">
          <p className="small muted">Your wallet is refunded because no field work has started.</p>
          <TextInput label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <ErrorAlert error={act.error} />
          <Button variant="danger" loading={act.pending} disabled={reason.length < 3} onClick={() => void act.run('cancel')}>Cancel verification</Button>
        </div>
      </Modal>
      <Modal open={modal === 'dispute'} onClose={() => setModal(null)} title="Raise a dispute">
        <div className="stack">
          <TextInput label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <TextArea label="Details" value={details} onChange={(e) => setDetails(e.target.value)} />
          <ErrorAlert error={act.error} />
          <Button loading={act.pending} disabled={!reason || !details} onClick={() => void act.run('dispute')}>Submit dispute</Button>
        </div>
      </Modal>
      <Modal open={modal === 'reverify'} onClose={() => setModal(null)} title="Request additional verification">
        <div className="stack">
          <SelectInput label="Level" value={level} onChange={(e) => setLevel(e.target.value)} options={['BASIC', 'STANDARD', 'ENHANCED'].map((l) => ({ value: l, label: humanize(l) }))} />
          <TextArea label="Instructions (optional)" value={details} onChange={(e) => setDetails(e.target.value)} />
          <ErrorAlert error={act.error} />
          <Button loading={act.pending} onClick={() => void act.run('reverify')}>Create follow-up request</Button>
        </div>
      </Modal>
    </div>
  );
}
