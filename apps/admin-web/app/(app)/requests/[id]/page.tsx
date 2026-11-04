'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { FINAL_OUTCOMES, FINDING_KEYS, FINDING_VALUES } from '@avn/contracts';
import { Badge, Button, Card, Checkbox, ChecklistPanel, DataTable, ErrorAlert, EvidencePanel, FindingsPanel, GpsPanel, ReportsPanel, RequestSummary, RiskPanel, SelectInput, Spinner, TextArea, TimelinePanel, formatDateTime, humanize, useAction, useApi, useAuth, useToast, type RequestDetail } from '@avn/ui';
import { api } from '@/lib/api';
import { ConfirmAction } from '@/components/confirm';

interface VerifierOption { id: string; fullName: string; status: string; available: boolean }

function ReviewPanel({ r, reload }: { r: RequestDetail; reload: () => Promise<void> }) {
  const toast = useToast();
  const open = r.manualReviews.find((m) => m.status !== 'RESOLVED');
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState('VERIFIED');
  const [revisit, setRevisit] = useState(false);
  const [override, setOverride] = useState<{ key: string; value: string } | null>(null);
  const addNote = useAction(async () => { await api.post(`/admin/reviews/${open!.id}/notes`, { note }); setNote(''); await reload(); });
  const resolve = useAction(async () => {
    await api.post(`/admin/reviews/${open!.id}/resolve`, { outcome, note, requestRevisit: revisit, findingOverrides: override ? [{ ...override, note }] : [] });
    toast(revisit ? 'Re-visit requested' : 'Review resolved and report issued');
    await reload();
  });
  if (!open) return null;
  return (
    <Card title="Manual review" actions={<Badge tone="warning">{humanize(open.status)}</Badge>}>
      <div className="stack">
        <div className="small">Triggered by {humanize(open.trigger)}: {open.reasons.join('; ')}</div>
        {open.notes?.length ? open.notes.map((n, i) => <div key={i} className="small"><strong>{n.byName ?? 'Reviewer'}</strong> · {formatDateTime(n.at)}: {n.note}</div>) : null}
        {open.status === 'OPEN' ? <Button variant="secondary" size="sm" onClick={async () => { await api.post(`/admin/reviews/${open.id}/claim`); await reload(); }}>Claim review</Button> : null}
        <TextArea label="Reviewer note" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button variant="secondary" size="sm" disabled={note.length < 3} loading={addNote.pending} onClick={() => void addNote.run()}>Add note</Button>
        <div className="grid grid-3">
          <SelectInput label="Final outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} options={FINAL_OUTCOMES.filter((o) => o !== 'MANUAL_REVIEW').map((o) => ({ value: o, label: humanize(o) }))} />
          <SelectInput label="Override a finding (optional)" value={override?.key ?? ''} onChange={(e) => setOverride(e.target.value ? { key: e.target.value, value: override?.value ?? 'CONFIRMED' } : null)} options={[{ value: '', label: 'No override' }, ...FINDING_KEYS.map((k) => ({ value: k, label: humanize(k) }))]} />
          {override ? <SelectInput label="New value" value={override.value} onChange={(e) => setOverride({ ...override, value: e.target.value })} options={FINDING_VALUES.map((v) => ({ value: v, label: humanize(v) }))} /> : null}
        </div>
        <Checkbox label="Request a new field visit instead of deciding" checked={revisit} onChange={setRevisit} />
        <ErrorAlert error={resolve.error} />
        <Button loading={resolve.pending} disabled={note.length < 3} onClick={() => void resolve.run()}>{revisit ? 'Request re-visit' : 'Resolve review'}</Button>
        <p className="small muted">The note is required and is stored in the audit trail. Overrides are recorded as reviewer findings alongside the engine findings.</p>
      </div>
    </Card>
  );
}

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const { can } = useAuth();
  const q = useApi<RequestDetail>(api, `/admin/requests/${id}`, { pollMs: 20000 });
  const verifiers = useApi<{ items: VerifierOption[] }>(api, '/admin/verifiers?status=APPROVED&pageSize=100');
  const [verifierId, setVerifierId] = useState('');
  if (q.loading) return <Spinner />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const r = q.data!;
  const assignable = ['READY_FOR_ASSIGNMENT', 'DISPATCHING'].includes(r.status);
  const active = !!r.assignment && ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'].includes(r.assignment.status);
  return (
    <div className="stack">
      <RequestSummary r={r} actions={can('assignments.manage') ? (
        <>
          {assignable ? <Button variant="secondary" size="sm" onClick={async () => { await api.post(`/admin/requests/${id}/redispatch`); toast('Search restarted from 15 minutes'); await q.reload(); }}>Restart search</Button> : null}
          {active ? <ConfirmAction trigger="Reassign" variant="secondary" title="Release the current verifier and redispatch?" onConfirm={async ({ reason }) => { await api.post(`/admin/requests/${id}/reassign`, { reason }); await q.reload(); }} /> : null}
          {!['COMPLETED', 'PARTIALLY_VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE', 'CANCELLED', 'EXPIRED', 'ARRIVED', 'VISIT_IN_PROGRESS', 'EVIDENCE_SUBMITTED', 'PROCESSING'].includes(r.status) ? <ConfirmAction trigger="Cancel" variant="danger" title="Cancel this request?" onConfirm={async ({ reason }) => { await api.post(`/admin/requests/${id}/cancel`, { reason }); await q.reload(); }} /> : null}
        </>
      ) : null} />
      {assignable && can('assignments.manage') ? (
        <Card title="Manual assignment">
          <div className="row">
            <div style={{ minWidth: 280 }}><SelectInput label="Approved verifier" value={verifierId} onChange={(e) => setVerifierId(e.target.value)} options={[{ value: '', label: 'Select verifier' }, ...(verifiers.data?.items ?? []).map((v) => ({ value: v.id, label: `${v.fullName}${v.available ? ' · on duty' : ''}` }))]} /></div>
            <div style={{ alignSelf: 'flex-end' }}>
              <ConfirmAction trigger="Assign" title="Manually assign this verifier?" onConfirm={async ({ reason }) => { await api.post(`/admin/requests/${id}/assign`, { verifierId, reason }); toast('Offer sent to the verifier'); await q.reload(); }} />
            </div>
          </div>
          <p className="small muted">The verifier must accept the assignment in the Agent app. Conflict-of-interest checks still apply.</p>
        </Card>
      ) : null}
      {can('reviews.manage') ? <ReviewPanel r={r} reload={q.reload} /> : null}
      <ReportsPanel r={r} audience="admin" />
      <FindingsPanel r={r} />
      <GpsPanel r={r} />
      <EvidencePanel r={r} showDevice />
      <div className="grid grid-2">
        <ChecklistPanel r={r} />
        <RiskPanel r={r} />
      </div>
      {r.offers?.length ? (
        <Card title="Dispatch offers">
          <DataTable rows={r.offers} rowKey={(o) => o.id} columns={[{ key: 'v', header: 'Verifier', render: (o) => <a className="mono small" href={`/verifiers/${o.verifierId}`}>{o.verifierId.slice(0, 8)}</a> }, { key: 't', header: 'Tier', render: (o) => (o.tier < 0 ? 'Manual' : o.tier) }, { key: 'w', header: 'Walk', render: (o) => `${o.walkingMinutes} min (${o.routingSource})` }, { key: 's', header: 'Status', render: (o) => humanize(o.status) }, { key: 'e', header: 'Expires', render: (o) => formatDateTime(o.expiresAt) }]} />
        </Card>
      ) : null}
      {r.assignmentHistory?.length ? (
        <Card title="Assignment history">
          <DataTable rows={r.assignmentHistory} rowKey={(a) => a.id} columns={[{ key: 'v', header: 'Verifier', render: (a) => a.verifierName }, { key: 's', header: 'Status', render: (a) => humanize(a.status) }, { key: 'a', header: 'Accepted', render: (a) => formatDateTime(a.acceptedAt) }, { key: 'r', header: 'Released', render: (a) => (a.releasedAt ? `${formatDateTime(a.releasedAt)} — ${a.releaseReason}` : '—') }]} />
        </Card>
      ) : null}
      {r.visit?.incidents?.length ? <Card title="Field incidents">{r.visit.incidents.map((i, k) => <div key={k} className="small"><Badge tone={i.kind === 'UNSAFE_CONDITIONS' ? 'danger' : 'warning'}>{humanize(i.kind)}</Badge> {formatDateTime(i.at)} — {i.message}</div>)}</Card> : null}
      <TimelinePanel r={r} />
    </div>
  );
}
