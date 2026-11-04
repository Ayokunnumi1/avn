'use client';
import { useParams } from 'next/navigation';
import { Card, DataTable, ErrorAlert, KeyValue, PageHeader, Spinner, Stat, StatusBadge, ToneBadge, formatDateTime, humanize, useApi, useToast } from '@avn/ui';
import { api } from '@/lib/api';
import { ConfirmAction } from '@/components/confirm';

interface V {
  id: string; fullName: string; email: string; phone: string; status: string; decisionReason: string | null; dateOfBirth: string; residentialAddress: string; photoUrl: string | null; idType: string | null; idNumberLast4: string | null;
  payoutAccount: { bank: string; last4: string; name: string } | null;
  identityChecks: Array<{ id: string; provider: string; idType: string; status: string; resultSummary: Record<string, unknown> | null; idDocumentUrl: string | null; selfieUrl: string | null; createdAt: string }>;
  performance: { reliabilityScore: string; completed: number; onTime: number; auditPass: number; auditFail: number };
  availability: { isAvailable: boolean; lastHeartbeatAt: string | null } | null;
  wallet: { pending: string; available: string; held: string } | null;
  fraudSignals: Array<{ id: string; rule: string; severity: string; explanation: string; status: string }>;
  assignments: Array<{ id: string; status: string; reference: string; requestStatus: string; outcome: string | null; acceptedAt: string }>;
}

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const q = useApi<V>(api, `/admin/verifiers/${id}`);
  if (q.loading) return <Spinner />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const v = q.data!;
  const decide = (decision: string) => async ({ reason }: { reason: string }) => {
    await api.post(`/admin/verifiers/${id}/decision`, { decision, reason });
    toast(`Verifier ${decision.toLowerCase()}d`);
    await q.reload();
  };
  return (
    <>
      <PageHeader title={v.fullName} subtitle={<ToneBadge value={v.status} />} actions={
        <>
          {['MANUAL_REVIEW', 'IDENTITY_PENDING'].includes(v.status) ? <ConfirmAction trigger="Approve" title="Approve verifier" onConfirm={decide('APPROVE')} /> : null}
          {['MANUAL_REVIEW', 'IDENTITY_PENDING', 'INCOMPLETE'].includes(v.status) ? <ConfirmAction trigger="Reject" title="Reject verifier" variant="danger" onConfirm={decide('REJECT')} /> : null}
          {v.status === 'APPROVED' ? <ConfirmAction trigger="Suspend" title="Suspend verifier" variant="danger" onConfirm={decide('SUSPEND')} /> : null}
          {v.status === 'SUSPENDED' ? <ConfirmAction trigger="Reinstate" title="Reinstate verifier" onConfirm={decide('REINSTATE')} /> : null}
        </>
      } />
      <div className="grid grid-2">
        <Card title="Registration">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {v.photoUrl ? <img src={v.photoUrl} alt="Verifier profile" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 12 }} /> : null}
            <KeyValue items={[['Email', v.email], ['Phone', v.phone], ['Date of birth', v.dateOfBirth], ['Address', v.residentialAddress], ['ID', v.idType ? `${humanize(v.idType)} ••${v.idNumberLast4}` : '—'], ['Payout', v.payoutAccount ? `${v.payoutAccount.bank} ••${v.payoutAccount.last4} (${v.payoutAccount.name})` : '—'], ['Decision note', v.decisionReason]]} />
          </div>
        </Card>
        <Card title="Performance">
          <div className="grid grid-2">
            <Stat label="Reliability" value={v.performance.reliabilityScore} />
            <Stat label="Completed" value={v.performance.completed} hint={`${v.performance.onTime} on time`} />
            <Stat label="Audits" value={`${v.performance.auditPass} pass`} hint={`${v.performance.auditFail} fail`} />
            <Stat label="Wallet" value={v.wallet?.available ?? '0.00'} hint={`pending ${v.wallet?.pending ?? '0.00'} · held ${v.wallet?.held ?? '0.00'}`} />
          </div>
        </Card>
      </div>
      <Card title="Identity verification results">
        {v.identityChecks.length ? v.identityChecks.map((c) => (
          <div key={c.id} className="stack-sm" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10, marginBottom: 10 }}>
            <div className="row"><ToneBadge value={c.status} /> <strong>{humanize(c.idType)}</strong> <span className="small muted">{c.provider} · {formatDateTime(c.createdAt)}</span>{c.provider === 'simulator' ? <span className="dev-label">Simulator result</span> : null}</div>
            <div className="row">
              {c.idDocumentUrl ? <a className="btn btn-secondary btn-sm" href={c.idDocumentUrl} target="_blank" rel="noreferrer">View ID document</a> : null}
              {c.selfieUrl ? <a className="btn btn-secondary btn-sm" href={c.selfieUrl} target="_blank" rel="noreferrer">View selfie</a> : null}
            </div>
            {c.resultSummary ? <pre className="mono small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(c.resultSummary, null, 2)}</pre> : null}
          </div>
        )) : <p className="muted">No identity submission yet.</p>}
      </Card>
      <Card title="Recent assignments">
        <DataTable rows={v.assignments} rowKey={(a) => a.id} empty="No assignments" columns={[{ key: 'r', header: 'Request', render: (a) => <a href={`/requests/${a.id}`} className="mono">{a.reference}</a> }, { key: 's', header: 'Status', render: (a) => <StatusBadge status={a.requestStatus} /> }, { key: 'o', header: 'Outcome', render: (a) => humanize(a.outcome) }, { key: 'd', header: 'Accepted', render: (a) => formatDateTime(a.acceptedAt) }]} />
      </Card>
      {v.fraudSignals.length ? (
        <Card title="Risk signals">{v.fraudSignals.map((s) => <div key={s.id} className="row small"><ToneBadge value={s.severity} /> {humanize(s.rule)} — {s.explanation} <span className="muted">{humanize(s.status)}</span></div>)}</Card>
      ) : null}
    </>
  );
}
