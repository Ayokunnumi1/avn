'use client';
import { useState } from 'react';
import { DEFAULT_POLICY_RULES, EVIDENCE_CATEGORIES, type PolicyRules } from '@avn/contracts';
import { Alert, Badge, Button, Card, Checkbox, ErrorAlert, Modal, PageHeader, Spinner, TextInput, formatDateTime, humanize, useAction, useApi, useAuth, useToast } from '@avn/ui';
import { api } from '@/lib/api';

interface Policy { id: string; name: string; description: string | null; level: string; isDefault: boolean; currentVersion: number; versions: Array<{ version: number; rules: PolicyRules; changeNote: string | null; createdAt: string }> }

function RulesEditor({ rules, onChange }: { rules: PolicyRules; onChange: (r: PolicyRules) => void }) {
  const num = (k: keyof PolicyRules, label: string, hint?: string) => <TextInput label={label} hint={hint} inputMode="numeric" value={String(rules[k])} onChange={(e) => onChange({ ...rules, [k]: Number(e.target.value.replace(/\D/g, '') || 0) })} />;
  return (
    <div className="stack">
      <Checkbox label="Applicant must be present" checked={rules.applicantPresenceRequired} onChange={(v) => onChange({ ...rules, applicantPresenceRequired: v })} />
      <Checkbox label="Residency confirmation required" checked={rules.residencyConfirmationRequired} onChange={(v) => onChange({ ...rules, residencyConfirmationRequired: v })} />
      <Checkbox label="Mandatory video walkthrough" checked={rules.mandatoryVideo} onChange={(v) => onChange({ ...rules, mandatoryVideo: v })} />
      <Checkbox label="Supporting document required from applicant" checked={rules.supportingDocumentRequired} onChange={(v) => onChange({ ...rules, supportingDocumentRequired: v })} />
      <div className="field">
        <span className="label">Required evidence</span>
        {EVIDENCE_CATEGORIES.filter((c) => c !== 'VIDEO_WALKTHROUGH').map((c) => (
          <Checkbox key={c} label={humanize(c)} checked={rules.requiredEvidence.includes(c)} onChange={(v) => onChange({ ...rules, requiredEvidence: v ? [...rules.requiredEvidence, c] : rules.requiredEvidence.filter((x) => x !== c) })} />
        ))}
      </div>
      <div className="grid grid-2">
        {num('verifierCount', 'Number of verifiers')}
        {num('manualReviewRiskThreshold', 'Manual review risk threshold', '0–100 — higher risk scores go to human review')}
        {num('reportFreshnessDays', 'Report freshness (days)')}
        {num('completionDeadlineHours', 'Completion deadline (hours)')}
      </div>
    </div>
  );
}

export default function Page() {
  const toast = useToast();
  const { can } = useAuth();
  const q = useApi<Policy[]>(api, '/org/policies');
  const [editing, setEditing] = useState<Policy | 'new' | null>(null);
  const [rules, setRules] = useState<PolicyRules>(DEFAULT_POLICY_RULES);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const save = useAction(async () => {
    if (editing === 'new') await api.post('/org/policies', { name, level: 'STANDARD', rules });
    else if (editing) await api.post(`/org/policies/${editing.id}/versions`, { rules, changeNote: note || undefined });
    toast('Policy saved');
    setEditing(null);
    await q.reload();
  });
  if (q.loading) return <Spinner />;
  return (
    <>
      <PageHeader title="Verification policies" subtitle="Versioned. A new version never changes requests that were already created." actions={can('policies.manage') ? <Button onClick={() => { setRules(DEFAULT_POLICY_RULES); setName(''); setEditing('new'); }}>New policy</Button> : null} />
      <div className="stack">
        {q.data?.map((p) => {
          const cur = p.versions.find((v) => v.version === p.currentVersion);
          return (
            <Card key={p.id} title={<h2>{p.name} {p.isDefault ? <Badge tone="primary">Default</Badge> : null}</h2>} actions={can('policies.manage') ? (
              <>
                {!p.isDefault ? <Button variant="ghost" size="sm" onClick={async () => { await api.post(`/org/policies/${p.id}/default`); await q.reload(); }}>Make default</Button> : null}
                <Button variant="secondary" size="sm" onClick={() => { setRules(cur?.rules ?? DEFAULT_POLICY_RULES); setNote(''); setEditing(p); }}>New version</Button>
              </>
            ) : null}>
              {cur ? (
                <div className="small stack-sm">
                  <div>v{cur.version} · {cur.rules.applicantPresenceRequired ? 'Presence required' : 'Presence optional'} · {cur.rules.residencyConfirmationRequired ? 'Residency required' : 'Residency optional'} · Evidence: {cur.rules.requiredEvidence.map(humanize).join(', ')} · Review ≥ {cur.rules.manualReviewRiskThreshold} risk · Fresh {cur.rules.reportFreshnessDays} d · Deadline {cur.rules.completionDeadlineHours} h</div>
                  <details><summary>Version history ({p.versions.length})</summary>{p.versions.map((v) => <div key={v.version}>v{v.version} · {formatDateTime(v.createdAt)} · {v.changeNote ?? '—'}</div>)}</details>
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New policy' : `New version of ${editing?.name ?? ''}`}>
        <div className="stack">
          {editing === 'new' ? <TextInput label="Policy name" value={name} onChange={(e) => setName(e.target.value)} /> : <TextInput label="Change note" value={note} onChange={(e) => setNote(e.target.value)} />}
          <RulesEditor rules={rules} onChange={setRules} />
          <Alert tone="info">Existing requests keep the version that was in force when they were created.</Alert>
          <ErrorAlert error={save.error} />
          <Button loading={save.pending} disabled={editing === 'new' && name.length < 1} onClick={() => void save.run()}>Save</Button>
        </div>
      </Modal>
    </>
  );
}
