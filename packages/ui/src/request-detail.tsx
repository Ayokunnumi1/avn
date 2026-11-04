'use client';
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import type { AppAudience } from '@avn/contracts';
import { downloadFile } from './api';
import { Alert, Badge, Button, Card, KeyValue, StatusBadge, ToneBadge, formatDateTime, formatMoney, humanize } from './components';

const MapView = dynamic(() => import('./map').then((m) => m.MapView), { ssr: false, loading: () => <div className="map skeleton" /> });

export interface RequestDetail {
  id: string;
  reference: string;
  status: string;
  statusLabel: string;
  outcome: string | null;
  outcomeLabel: string | null;
  source: string;
  level: string;
  purpose: string;
  priority: string;
  customerReference: string | null;
  department: string | null;
  applicant: { name: string; phone: string; email: string | null };
  address: { lines: string[]; lat: number; lng: number; landmark: string | null; source: string; gpsAccuracyM: number | null } | null;
  policy: { name: string | null; version: number | null; rules: Record<string, unknown> };
  price: string;
  currency: string;
  deadline: string | null;
  instructions: string | null;
  riskScore: number;
  riskFlagged: boolean;
  coverageFallback: string | null;
  createdAt: string;
  outcomeAt: string | null;
  invitation: { status: string; expiresAt: string; sendCount: number; openedAt: string | null } | null;
  timeline: Array<{ from: string | null; to: string; label: string; actorType: string; note: string | null; at: string }>;
  findings: Array<{ key: string; label: string; value: string; valueLabel: string; basis: string[]; source: string; rulesVersion: string }>;
  reports: Array<{ id: string; reference: string; version: number; outcome: string; issuedAt: string; validUntil: string; revokedAt: string | null; aiAssisted: boolean; contentHash: string; summary: string }>;
  disputes: Array<{ id: string; raisedByType: string; reason: string; details: string; status: string; resolutionNote: string | null; createdAt: string }>;
  manualReviews: Array<{ id: string; status: string; trigger: string; reasons: string[]; outcome: string | null; createdAt: string; notes?: Array<{ byName?: string; note: string; at: string }> }>;
  riskSignals: Array<{ id: string; rule: string; severity: string; score: number; explanation: string; status: string; createdAt: string }>;
  assignment: { id: string; status: string; verifierCode: string; verifierId?: string; verifierName?: string; verifierPhone?: string; acceptedAt: string; arrivedAt: string | null; submittedAt: string | null; walkingMinutes: string | null; routingSource: string | null } | null;
  assignmentHistory?: Array<{ id: string; status: string; verifierId: string; verifierName: string; acceptedAt: string; releasedAt: string | null; releaseReason: string | null }>;
  offers?: Array<{ id: string; verifierId: string; tier: number; status: string; walkingMinutes: string; routingSource: string; expiresAt: string; declineReason: string | null }>;
  visit: {
    arrivedAt: string | null;
    arrival: { lat: number; lng: number; accuracyM: number; distanceFromTargetM: number; thresholdM: number; withinThreshold: boolean; exception: string | null; exceptionNote: string | null } | null;
    integritySignals: Record<string, unknown> | null;
    checklist: Record<string, unknown> | null;
    applicantConfirmedAt: string | null;
    confirmationMethod: string | null;
    submittedAt: string | null;
    incidents?: Array<{ kind: string; message: string; at: string }>;
    evidence: Array<{ id: string; category: string; url: string; capturedAt: string; receivedAt: string; lat: number; lng: number; accuracyM: number; distanceFromTargetM: number | null; sha256: string; compressed: boolean; duplicateOf: string | null; deviceRef?: string; aiSuggestion: { label: string; nextAction: string | null; explanation: string | null; confidence: number | null; model?: string; promptVersion?: string } | null }>;
    evidenceCount: number;
  } | null;
  documents: Array<{ id: string; documentType: string; url: string; createdAt: string }> | number;
}

export function RequestSummary({ r, actions }: { r: RequestDetail; actions?: ReactNode }) {
  return (
    <Card>
      <div className="row between">
        <div>
          <h1 style={{ marginBottom: 4 }}>{r.reference}</h1>
          <div className="row small">
            <StatusBadge status={r.status} />
            {r.outcomeLabel ? <Badge tone={r.outcome === 'VERIFIED' ? 'success' : 'warning'}>{r.outcomeLabel}</Badge> : null}
            {r.riskFlagged ? <Badge tone="danger">Risk score {r.riskScore}</Badge> : null}
            <span className="muted">
              {humanize(r.source)} · {r.level} · {humanize(r.purpose)}
            </span>
          </div>
        </div>
        {actions ? <div className="row">{actions}</div> : null}
      </div>
      {r.coverageFallback ? (
        <div style={{ marginTop: 12 }}>
          <Alert tone="warning" title="No verifier within 45 minutes' walk">
            Options: {r.coverageFallback.split(',').map(humanize).join(' · ')}. The system keeps retrying automatically.
          </Alert>
        </div>
      ) : null}
      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <KeyValue
          items={[
            ['Applicant', r.applicant.name],
            ['Phone', r.applicant.phone],
            ['Email', r.applicant.email],
            ['Customer ref', r.customerReference],
            ['Department', r.department],
          ]}
        />
        <KeyValue
          items={[
            ['Policy', r.policy.name ? `${r.policy.name}${r.policy.version ? ` (v${r.policy.version}, frozen at creation)` : ''}` : '—'],
            ['Priority', humanize(r.priority)],
            ['Deadline', formatDateTime(r.deadline)],
            ['Charged', formatMoney(r.price, r.currency)],
            ['Invitation', r.invitation ? `${humanize(r.invitation.status)} · sent ${r.invitation.sendCount}× · expires ${formatDateTime(r.invitation.expiresAt)}` : '—'],
          ]}
        />
      </div>
    </Card>
  );
}

export function FindingsPanel({ r }: { r: RequestDetail }) {
  if (!r.findings.length) return null;
  return (
    <Card title="Field findings" actions={<span className="small muted">Rules {r.findings[0]?.rulesVersion}</span>}>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Finding</th>
              <th>Result</th>
              <th>Basis</th>
            </tr>
          </thead>
          <tbody>
            {r.findings.map((f) => (
              <tr key={f.key}>
                <td style={{ fontWeight: 650 }}>{f.label}</td>
                <td>
                  <ToneBadge value={f.value} />
                  {f.source === 'REVIEWER' ? <div className="small muted">Reviewer override</div> : null}
                </td>
                <td className="small">{f.basis.join('. ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>A building existing does not establish residency; applicant absence does not mean the address is false; documents do not independently establish the physical address.</p>
    </Card>
  );
}

export function GpsPanel({ r }: { r: RequestDetail }) {
  if (!r.address) return null;
  const v = r.visit;
  const markers = [
    { id: 'pin', lat: r.address.lat, lng: r.address.lng, label: 'Applicant pin', color: '#b42318' },
    ...(v?.arrival ? [{ id: 'arrival', lat: v.arrival.lat, lng: v.arrival.lng, label: `Arrival (±${Math.round(v.arrival.accuracyM)} m)`, color: '#175cd3' }] : []),
    ...(v?.evidence ?? []).map((e) => ({ id: e.id, lat: e.lat, lng: e.lng, label: humanize(e.category), color: '#0f766e' })),
  ];
  return (
    <Card title="Location & GPS">
      <div className="grid grid-2">
        <MapView center={{ lat: r.address.lat, lng: r.address.lng }} zoom={17} markers={markers} accuracy={v?.arrival ? { lat: v.arrival.lat, lng: v.arrival.lng, radiusM: v.arrival.accuracyM } : null} fitToContent={markers.length > 1} ariaLabel="Pin, arrival and evidence locations" />
        <KeyValue
          items={[
            ['Address', r.address.lines.join(', ')],
            ['Landmark', r.address.landmark],
            ['Pin source', `${humanize(r.address.source)}${r.address.gpsAccuracyM ? ` (±${Math.round(r.address.gpsAccuracyM)} m)` : ''}`],
            ['Pin', `${r.address.lat.toFixed(6)}, ${r.address.lng.toFixed(6)}`],
            ['Arrived', v?.arrivedAt ? formatDateTime(v.arrivedAt) : '—'],
            ['Distance from pin', v?.arrival ? `${v.arrival.distanceFromTargetM} m (threshold ${v.arrival.thresholdM} m)` : '—'],
            ['Within threshold', v?.arrival ? (v.arrival.withinThreshold ? <Badge tone="success">Yes</Badge> : <Badge tone="warning">No — reviewed</Badge>) : '—'],
            ['Exception', v?.arrival?.exception && v.arrival.exception !== 'NONE' ? `${humanize(v.arrival.exception)}${v.arrival.exceptionNote ? ` — ${v.arrival.exceptionNote}` : ''}` : 'None'],
            ['Applicant confirmation', v?.applicantConfirmedAt ? `${humanize(v.confirmationMethod)} · ${formatDateTime(v.applicantConfirmedAt)}` : 'Not confirmed'],
            ['Walking time at acceptance', r.assignment?.walkingMinutes ? `${r.assignment.walkingMinutes} min (${r.assignment.routingSource})` : '—'],
          ]}
        />
      </div>
    </Card>
  );
}

export function EvidencePanel({ r, showDevice }: { r: RequestDetail; showDevice?: boolean }) {
  const v = r.visit;
  if (!v) return null;
  if (!v.evidence.length)
    return (
      <Card title="Evidence">
        <p className="muted">{v.evidenceCount ? `${v.evidenceCount} item(s) captured — you do not have permission to view evidence.` : 'No evidence yet.'}</p>
      </Card>
    );
  return (
    <Card title={`Evidence (${v.evidence.length})`} actions={<span className="small muted">Links expire after 10 minutes</span>}>
      <div className="evidence-grid">
        {v.evidence.map((e) => (
          <figure key={e.id}>
            <a href={e.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={e.url} alt={`${humanize(e.category)} photo`} loading="lazy" />
            </a>
            <figcaption>
              <strong>{humanize(e.category)}</strong>
              <br />
              {formatDateTime(e.capturedAt)} · {e.distanceFromTargetM} m · ±{Math.round(e.accuracyM)} m
              <br />
              <span className="mono" title={e.sha256}>
                sha256 {e.sha256.slice(0, 12)}…
              </span>
              {e.compressed ? ' · compressed' : ''}
              {e.duplicateOf ? (
                <>
                  <br />
                  <Badge tone="danger">Duplicate image</Badge>
                </>
              ) : null}
              {showDevice && e.deviceRef ? <div className="mono">{e.deviceRef}</div> : null}
              {e.aiSuggestion ? (
                <div style={{ marginTop: 6, color: 'var(--info)' }}>
                  <em>{e.aiSuggestion.label}</em>: {e.aiSuggestion.nextAction ?? e.aiSuggestion.explanation}
                </div>
              ) : null}
            </figcaption>
          </figure>
        ))}
      </div>
      {Array.isArray(r.documents) && r.documents.length ? (
        <div style={{ marginTop: 14 }}>
          <h3>Applicant documents (supplementary)</h3>
          {r.documents.map((d) => (
            <div key={d.id} className="small">
              <a href={d.url} target="_blank" rel="noreferrer">
                {humanize(d.documentType)}
              </a>{' '}
              · {formatDateTime(d.createdAt)}
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

export function ChecklistPanel({ r }: { r: RequestDetail }) {
  const c = r.visit?.checklist;
  if (!c) return null;
  return (
    <Card title="Verifier checklist">
      <KeyValue items={Object.entries(c).map(([k, v]) => [humanize(k.replace(/([A-Z])/g, '_$1')), typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v ?? '—')])} />
    </Card>
  );
}

export function ReportsPanel({ r, audience }: { r: RequestDetail; audience: AppAudience }) {
  if (!r.reports.length) return null;
  return (
    <Card title="Reports">
      <div className="stack">
        {r.reports.map((rep) => (
          <div key={rep.id} className="stack-sm" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
            <div className="row between">
              <span>
                <strong className="mono">{rep.reference}</strong> v{rep.version} {rep.revokedAt ? <Badge>Superseded</Badge> : <Badge tone="success">Current</Badge>} {rep.aiAssisted ? <Badge tone="info">AI-assisted wording</Badge> : null}
              </span>
              <Button size="sm" onClick={() => void downloadFile(audience, `/reports/${rep.id}/pdf`, `${rep.reference}.pdf`)}>
                Download PDF
              </Button>
            </div>
            <p style={{ margin: 0 }}>{rep.summary}</p>
            <div className="small muted">
              Issued {formatDateTime(rep.issuedAt)} · valid until {formatDateTime(rep.validUntil)} ·{' '}
              <span className="mono" title={rep.contentHash}>
                hash {rep.contentHash.slice(0, 16)}…
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function TimelinePanel({ r }: { r: RequestDetail }) {
  return (
    <Card title="Audit timeline">
      <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {r.timeline.map((t, i) => (
          <li key={i} className="row small" style={{ alignItems: 'flex-start' }}>
            <span className="muted" style={{ minWidth: 150 }}>
              {formatDateTime(t.at)}
            </span>
            <StatusBadge status={t.to} />
            <span className="muted">{humanize(t.actorType)}</span>
            {t.note ? <span>{t.note}</span> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function RiskPanel({ r }: { r: RequestDetail }) {
  if (!r.riskSignals.length && !r.manualReviews.length) return null;
  return (
    <Card title="Risk & review">
      <div className="stack-sm">
        {r.manualReviews.map((m) => (
          <Alert key={m.id} tone={m.status === 'RESOLVED' ? 'success' : 'warning'} title={`Manual review — ${humanize(m.status)}${m.outcome ? ` (${humanize(m.outcome)})` : ''}`}>
            {m.reasons.join('; ')}
          </Alert>
        ))}
        {r.riskSignals.map((s) => (
          <div key={s.id} className="row small">
            <ToneBadge value={s.severity} />
            <strong>{humanize(s.rule)}</strong>
            <span>{s.explanation}</span>
            <span className="muted">{humanize(s.status)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
