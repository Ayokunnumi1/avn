'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, ErrorAlert, KeyValue, Modal, Spinner, StatusBadge, TextArea, TextInput, Timeline, downloadFile, formatDateTime, formatMoney, humanize, useAction, useApi, useToast } from '@avn/ui';
import { api } from '@/lib/api';
import { VerificationWizard } from '@/components/wizard';

const MapView = dynamic(() => import('@avn/ui/map').then((m) => m.MapView), { ssr: false });

interface Detail {
  id: string;
  reference: string;
  status: string;
  statusLabel: string;
  outcome: string | null;
  outcomeLabel: string | null;
  level: string;
  purpose: string;
  source: string;
  requestedBy: string | null;
  lockedFields: string[];
  applicantName: string;
  address: { lines: string[]; lat: number; lng: number; landmark: string | null } | null;
  price: string | null;
  currency: string;
  paid: boolean | null;
  payment: { reference: string; status: string } | null;
  coverageFallback: string | null;
  timeline: Array<{ key: string; label: string; done: boolean; current: boolean; at: string | null }>;
  terminal: { status: string; at: string } | null;
  visit: { arrivedAt: string | null; applicantConfirmedAt: string | null; confirmationPending: boolean } | null;
  documents: Array<{ id: string; documentType: string; createdAt: string }>;
  report: { id: string; reference: string; outcome: string; outcomeLabel: string; issuedAt: string; validUntil: string; summary: string; contentHashPrefix: string } | null;
  disputes: Array<{ id: string; reason: string; status: string; createdAt: string; resolutionNote: string | null }>;
}

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const q = useApi<Detail>(api, `/me/requests/${id}`, { pollMs: 15000 });
  const [dispute, setDispute] = useState(false);
  const [share, setShare] = useState<string>();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const confirm = useAction(async () => {
    await api.post(`/me/requests/${id}/visit/confirm`);
    toast('Thank you — your confirmation was recorded.');
    await q.reload();
  });
  const pay = useAction(async () => {
    const r = await api.post<{ authorizationUrl: string }>(`/me/requests/${id}/pay`);
    window.location.href = r.authorizationUrl;
  });
  const raise = useAction(async () => {
    await api.post(`/me/requests/${id}/disputes`, { reason, details });
    setDispute(false);
    toast('Dispute submitted. A reviewer will respond.');
    await q.reload();
  });
  if (q.loading) return <Spinner />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const r = q.data!;

  if (r.status === 'AWAITING_APPLICANT') {
    return (
      <div className="stack">
        <h1>Complete your verification</h1>
        <p className="muted">{r.requestedBy} asked you to verify your residential address. Reference {r.reference}.</p>
        <VerificationWizard request={{ id: r.id, applicantName: r.applicantName, lockedFields: r.lockedFields, purpose: r.purpose, level: r.level, requestedBy: r.requestedBy }} onDone={() => void q.reload()} />
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <h1 style={{ marginBottom: 4 }}>Verification {r.reference}</h1>
          <div className="row small muted">
            <StatusBadge status={r.status} /> <span>{r.requestedBy ? `Requested by ${r.requestedBy}` : 'Personal verification'}</span> <span>· {r.level}</span>
          </div>
        </div>
      </div>
      {r.source === 'INDIVIDUAL' && !r.paid && r.status === 'CREATED' ? (
        <Alert tone="warning" title="Payment needed">
          {formatMoney(r.price, r.currency)} — your request is dispatched once payment is confirmed.
          <div style={{ marginTop: 8 }}>
            <Button loading={pay.pending} onClick={() => void pay.run()}>
              Pay now
            </Button>
          </div>
          <ErrorAlert error={pay.error} />
        </Alert>
      ) : null}
      {r.coverageFallback && ['READY_FOR_ASSIGNMENT', 'DISPATCHING'].includes(r.status) ? (
        <Alert tone="info" title="Finding a verifier is taking longer">
          No verifier is within walking distance right now. We will keep trying (delayed assignment); our team may also arrange alternative transport or a professional field agent.
        </Alert>
      ) : null}
      {r.visit?.arrivedAt && r.status === 'VISIT_IN_PROGRESS' && !r.visit.applicantConfirmedAt ? (
        <Alert tone="success" title="A verifier is at your address">
          Confirm here, or read your visit code (sent by SMS and in your notifications) to the verifier.
          <div style={{ marginTop: 8 }}>
            <Button loading={confirm.pending} onClick={() => void confirm.run()}>
              Yes, the verifier is here
            </Button>
          </div>
        </Alert>
      ) : null}
      <div className="grid grid-2">
        <Card title="Progress">
          {r.terminal ? <Alert tone="warning">{humanize(r.terminal.status)} on {formatDateTime(r.terminal.at)}</Alert> : <Timeline steps={r.timeline} />}
        </Card>
        <Card title="Address">
          {r.address ? (
            <div className="stack-sm">
              <div>{r.address.lines.join(', ')}</div>
              {r.address.landmark ? <div className="small muted">Landmark: {r.address.landmark}</div> : null}
              <MapView center={{ lat: r.address.lat, lng: r.address.lng }} zoom={17} pin={r.address} ariaLabel="Your submitted location" />
            </div>
          ) : (
            <p className="muted">Not submitted yet.</p>
          )}
        </Card>
      </div>
      {r.report ? (
        <Card title="Report" actions={<Badge tone={r.report.outcome === 'VERIFIED' ? 'success' : 'warning'}>{r.report.outcomeLabel}</Badge>}>
          <div className="stack">
            <p>{r.report.summary}</p>
            <KeyValue items={[['Report reference', <span className="mono">{r.report.reference}</span>], ['Issued', formatDateTime(r.report.issuedAt)], ['Valid until', formatDateTime(r.report.validUntil)]]} />
            <div className="row">
              <Button onClick={() => void downloadFile('applicant', `/reports/${r.report!.id}/pdf`, `${r.report!.reference}.pdf`)}>Download PDF</Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  const s = await api.post<{ url: string; expiresAt: string }>(`/reports/${r.report!.id}/share`);
                  setShare(`${window.location.origin}${s.url}`);
                }}
              >
                Create share link
              </Button>
              <Link className="btn btn-ghost" href={`/reports/verify?ref=${r.report.reference}&h=${r.report.contentHashPrefix}`}>
                Check validity
              </Link>
              {!r.requestedBy ? (
                <Button variant="ghost" onClick={() => router.push('/verifications/new')}>
                  Request a new verification
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => setDispute(true)}>
                Raise a dispute
              </Button>
            </div>
            {share ? (
              <Alert tone="info" title="Share link (valid 7 days)">
                <input className="input mono" readOnly value={share} onFocus={(e) => e.target.select()} />
              </Alert>
            ) : null}
          </div>
        </Card>
      ) : null}
      {r.disputes.length ? (
        <Card title="Disputes">
          {r.disputes.map((d) => (
            <div key={d.id} className="row between">
              <span>{d.reason}</span>
              <Badge tone={d.status === 'UPHELD' ? 'success' : d.status === 'REJECTED' ? 'danger' : 'warning'}>{humanize(d.status)}</Badge>
              {d.resolutionNote ? <span className="small muted">{d.resolutionNote}</span> : null}
            </div>
          ))}
        </Card>
      ) : null}
      {r.documents.length ? (
        <Card title="Your documents">
          {r.documents.map((d) => (
            <div key={d.id} className="small">
              {humanize(d.documentType)} · {formatDateTime(d.createdAt)}
            </div>
          ))}
        </Card>
      ) : null}
      <Modal open={dispute} onClose={() => setDispute(false)} title="Raise a dispute">
        <div className="stack">
          <TextInput label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
          <TextArea label="What is wrong?" value={details} onChange={(e) => setDetails(e.target.value)} required />
          <ErrorAlert error={raise.error} />
          <Button loading={raise.pending} disabled={!reason || details.length < 1} onClick={() => void raise.run()}>
            Submit dispute
          </Button>
        </div>
      </Modal>
    </div>
  );
}
