'use client';
import { useEffect, useState } from 'react';
import { AI_FEATURES } from '@avn/contracts';
import { Alert, Badge, Button, Card, Checkbox, DataTable, ErrorAlert, PageHeader, Spinner, Stat, TextInput, ToneBadge, formatDateTime, humanize, useAction, useApi, useToast } from '@avn/ui';
import { api } from '@/lib/api';

interface AiCfg { enabled: boolean; features: Record<string, { enabled: boolean; model: string }>; monthlyBudgetUsd: number; maxImagesPerVisit: number; riskReviewThreshold: number }
interface AiAdmin { provider: string; providerConfigured: boolean; defaultModels: { text: string; vision: string }; config: AiCfg; monthSpendUsd: number; usage: Array<{ feature: string; model: string; _count: number; _sum: { inputTokens: number | null; outputTokens: number | null; costUsd: string | null } }>; history: Array<{ id: string; feature: string; model: string; promptVersion: string; status: string; confidence: number | null; nextAction: string | null; error: string | null; latencyMs: number | null; createdAt: string }> }

export default function Page() {
  const toast = useToast();
  const q = useApi<AiAdmin>(api, '/admin/ai');
  const [cfg, setCfg] = useState<AiCfg | null>(null);
  const [password, setPassword] = useState('');
  useEffect(() => { if (q.data) setCfg(q.data.config); }, [q.data]);
  const save = useAction(async () => { await api.put('/admin/ai', { ...cfg, confirmPassword: password }); setPassword(''); toast('AI configuration saved'); await q.reload(); });
  if (q.loading || !cfg) return <Spinner />;
  const d = q.data!;
  return (
    <>
      <PageHeader title="AI administration" subtitle="AI is optional and advisory: it never decides verification outcomes. Provider keys never reach the browser." />
      {!d.providerConfigured ? <Alert tone="info" title="AI provider not configured">Set AI_PROVIDER=anthropic and ANTHROPIC_API_KEY on the API server to enable AI assistance. The platform runs fully without it using deterministic fallbacks.</Alert> : null}
      <div className="grid grid-3">
        <Stat label="Provider" value={d.provider} hint={`Defaults: ${d.defaultModels.text}`} />
        <Stat label="Spend this month" value={`$${d.monthSpendUsd.toFixed(2)}`} hint={`Budget $${cfg.monthlyBudgetUsd}`} tone={d.monthSpendUsd >= cfg.monthlyBudgetUsd ? 'danger' : undefined} />
        <Stat label="Calls (30 days)" value={d.usage.reduce((n, u) => n + u._count, 0)} />
      </div>
      <Card title="Configuration">
        <div className="stack">
          <Checkbox label="AI assistance enabled" checked={cfg.enabled} onChange={(v) => setCfg({ ...cfg, enabled: v })} />
          <div className="table-wrap"><table className="table"><thead><tr><th>Feature</th><th>Enabled</th><th>Model</th></tr></thead><tbody>
            {AI_FEATURES.map((f) => (
              <tr key={f}><td>{humanize(f)}</td><td><input type="checkbox" aria-label={`${f} enabled`} checked={cfg.features[f]?.enabled ?? false} onChange={(e) => setCfg({ ...cfg, features: { ...cfg.features, [f]: { model: cfg.features[f]?.model ?? d.defaultModels.text, enabled: e.target.checked } } })} /></td><td><input className="input" aria-label={`${f} model`} value={cfg.features[f]?.model ?? ''} onChange={(e) => setCfg({ ...cfg, features: { ...cfg.features, [f]: { enabled: cfg.features[f]?.enabled ?? true, model: e.target.value } } })} /></td></tr>
            ))}
          </tbody></table></div>
          <div className="grid grid-3">
            <TextInput label="Monthly budget (USD)" value={String(cfg.monthlyBudgetUsd)} onChange={(e) => setCfg({ ...cfg, monthlyBudgetUsd: Number(e.target.value) || 0 })} />
            <TextInput label="Max images analysed per visit" value={String(cfg.maxImagesPerVisit)} onChange={(e) => setCfg({ ...cfg, maxImagesPerVisit: Number(e.target.value) || 0 })} />
            <TextInput label="Risk threshold for human review" value={String(cfg.riskReviewThreshold)} onChange={(e) => setCfg({ ...cfg, riskReviewThreshold: Number(e.target.value) || 0 })} />
          </div>
          <div className="row">
            <TextInput label="Confirm your password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button style={{ alignSelf: 'flex-end' }} disabled={!password} loading={save.pending} onClick={() => void save.run()}>Save</Button>
          </div>
          <ErrorAlert error={save.error} />
        </div>
      </Card>
      <Card title="Usage by feature (30 days)">
        <DataTable rows={d.usage} rowKey={(u) => `${u.feature}-${u.model}`} empty="No AI usage yet" columns={[{ key: 'f', header: 'Feature', render: (u) => humanize(u.feature) }, { key: 'm', header: 'Model', render: (u) => u.model }, { key: 'c', header: 'Calls', render: (u) => u._count }, { key: 't', header: 'Tokens in/out', render: (u) => `${u._sum.inputTokens ?? 0} / ${u._sum.outputTokens ?? 0}` }, { key: 'u', header: 'Cost', render: (u) => `$${Number(u._sum.costUsd ?? 0).toFixed(4)}` }]} />
      </Card>
      <Card title="Analysis history">
        <DataTable rows={d.history} rowKey={(h) => h.id} empty="No analyses yet" columns={[{ key: 't', header: 'When', render: (h) => formatDateTime(h.createdAt) }, { key: 'f', header: 'Feature', render: (h) => humanize(h.feature) }, { key: 's', header: 'Status', render: (h) => <ToneBadge value={h.status} /> }, { key: 'p', header: 'Prompt', render: (h) => <span className="mono small">{h.promptVersion}</span> }, { key: 'o', header: 'Result', render: (h) => <span className="small">{h.nextAction ?? h.error ?? '—'}</span> }, { key: 'c', header: 'Conf.', render: (h) => (h.confidence != null ? <Badge>{Math.round(h.confidence * 100)}%</Badge> : '—') }]} />
      </Card>
    </>
  );
}
