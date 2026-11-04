'use client';
import { useState } from 'react';
import { WEBHOOK_EVENTS } from '@avn/contracts';
import { Alert, Badge, Button, Card, Checkbox, DataTable, ErrorAlert, Modal, PageHeader, TextInput, formatDateTime, humanize, useAction, useApi, useToast } from '@avn/ui';
import { api } from '@/lib/api';

interface Key { id: string; name: string; keyPrefix: string; scopes: string[]; requestCount: number; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }
interface Hook { id: string; url: string; events: string[]; active: boolean; createdAt: string }
interface Delivery { id: string; event: string; status: string; attempts: number; responseStatus: number | null; lastError: string | null; createdAt: string }
interface Usage { daily: Array<{ day: string; requests: number; errors: number }>; rateLimit: { requestsPerMinute: number } }

const SCOPES = ['requests:write', 'requests:read', 'reports:read'];

export default function Page() {
  const toast = useToast();
  const keys = useApi<Key[]>(api, '/org/developers/api-keys');
  const hooks = useApi<Hook[]>(api, '/org/developers/webhooks');
  const usage = useApi<Usage>(api, '/org/developers/usage');
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [keyForm, setKeyForm] = useState({ name: '', scopes: [...SCOPES] });
  const [hookForm, setHookForm] = useState({ url: '', events: ['verification.completed', 'report.issued'] as string[] });
  const [deliveries, setDeliveries] = useState<{ hook: Hook; items: Delivery[] } | null>(null);
  const createKey = useAction(async () => {
    const r = await api.post<{ key: string }>('/org/developers/api-keys', keyForm);
    setSecret({ title: 'Your new API key', value: r.key });
    setKeyForm({ name: '', scopes: [...SCOPES] });
    await keys.reload();
  });
  const createHook = useAction(async () => {
    const r = await api.post<{ signingSecret: string }>('/org/developers/webhooks', hookForm);
    setSecret({ title: 'Webhook signing secret', value: r.signingSecret });
    await hooks.reload();
  });
  const total = usage.data?.daily.reduce((n, d) => n + d.requests, 0) ?? 0;
  return (
    <>
      <PageHeader title="API & webhooks" subtitle={<>REST API at <code>/api/v1/integrations</code> · <a href="/api/docs" target="_blank" rel="noreferrer">OpenAPI documentation</a></>} />
      <Card title="Quick start">
        <pre className="mono small" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 12, borderRadius: 8, margin: 0 }}>{`curl -X POST $AVN_API/api/v1/integrations/verifications \\
  -H "Authorization: Bearer avn_live_…" -H "Idempotency-Key: <unique>" \\
  -H "Content-Type: application/json" \\
  -d '{"applicantName":"Ada Obi","applicantPhone":"08031234567","customerReference":"CUST-1","level":"STANDARD"}'

# Webhooks are signed: X-AVN-Signature: t=<unix>,v1=hex(HMAC_SHA256(secret, "<t>.<raw body>"))`}</pre>
      </Card>
      <div className="grid grid-2">
        <Card title="Create API key">
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void createKey.run(); }}>
            <TextInput label="Key name" value={keyForm.name} onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })} required />
            {SCOPES.map((s) => <Checkbox key={s} label={s} checked={keyForm.scopes.includes(s)} onChange={(v) => setKeyForm({ ...keyForm, scopes: v ? [...keyForm.scopes, s] : keyForm.scopes.filter((x) => x !== s) })} />)}
            <ErrorAlert error={createKey.error} />
            <Button type="submit" loading={createKey.pending}>Create key</Button>
          </form>
        </Card>
        <Card title="Add webhook endpoint">
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void createHook.run(); }}>
            <TextInput label="HTTPS URL" type="url" value={hookForm.url} onChange={(e) => setHookForm({ ...hookForm, url: e.target.value })} required />
            {WEBHOOK_EVENTS.map((ev) => <Checkbox key={ev} label={ev} checked={hookForm.events.includes(ev)} onChange={(v) => setHookForm({ ...hookForm, events: v ? [...hookForm.events, ev] : hookForm.events.filter((x) => x !== ev) })} />)}
            <ErrorAlert error={createHook.error} />
            <Button type="submit" loading={createHook.pending}>Add endpoint</Button>
          </form>
        </Card>
      </div>
      <Card title="API keys" actions={<span className="small muted">{total} requests in 30 days · limit {usage.data?.rateLimit.requestsPerMinute ?? 120}/min per key</span>}>
        <DataTable rows={keys.data ?? []} rowKey={(k) => k.id} empty="No keys yet" columns={[
          { key: 'n', header: 'Name', render: (k) => k.name },
          { key: 'p', header: 'Key', render: (k) => <span className="mono small">{k.keyPrefix}.••••</span> },
          { key: 's', header: 'Scopes', render: (k) => <span className="small">{k.scopes.join(', ')}</span> },
          { key: 'u', header: 'Usage', render: (k) => `${k.requestCount} · last ${formatDateTime(k.lastUsedAt)}` },
          { key: 'st', header: 'Status', render: (k) => (k.revokedAt ? <Badge>Revoked</Badge> : <Badge tone="success">Active</Badge>) },
          { key: 'a', header: '', render: (k) => (!k.revokedAt ? <span className="row"><Button size="sm" variant="secondary" onClick={async () => { const r = await api.post<{ key: string }>(`/org/developers/api-keys/${k.id}/rotate`); setSecret({ title: 'Rotated key (old key revoked)', value: r.key }); await keys.reload(); }}>Rotate</Button><Button size="sm" variant="ghost" onClick={async () => { await api.del(`/org/developers/api-keys/${k.id}`); await keys.reload(); }}>Revoke</Button></span> : null) },
        ]} />
      </Card>
      <Card title="Webhook endpoints">
        <DataTable rows={hooks.data ?? []} rowKey={(h) => h.id} empty="No endpoints yet" columns={[
          { key: 'u', header: 'URL', render: (h) => <span className="mono small">{h.url}</span> },
          { key: 'e', header: 'Events', render: (h) => <span className="small">{h.events.join(', ')}</span> },
          { key: 's', header: 'Status', render: (h) => (h.active ? <Badge tone="success">Active</Badge> : <Badge>Disabled</Badge>) },
          { key: 'a', header: '', render: (h) => (
            <span className="row">
              <Button size="sm" variant="secondary" onClick={async () => { const r = await api.post<{ status: string; responseStatus: number | null; lastError: string | null }>(`/org/developers/webhooks/${h.id}/test`); toast(`Test delivery: ${r.status}${r.responseStatus ? ` (HTTP ${r.responseStatus})` : ''}${r.lastError ? ` — ${r.lastError}` : ''}`, r.status !== 'SENT'); }}>Send test</Button>
              <Button size="sm" variant="ghost" onClick={async () => setDeliveries({ hook: h, items: await api.get<Delivery[]>(`/org/developers/webhooks/${h.id}/deliveries`) })}>Deliveries</Button>
              {h.active ? <Button size="sm" variant="ghost" onClick={async () => { await api.del(`/org/developers/webhooks/${h.id}`); await hooks.reload(); }}>Disable</Button> : null}
            </span>
          ) },
        ]} />
      </Card>
      <Modal open={!!secret} onClose={() => setSecret(null)} title={secret?.title ?? ''}>
        <div className="stack">
          <Alert tone="warning">Copy it now — for security it will never be shown again.</Alert>
          <input className="input mono" readOnly value={secret?.value ?? ''} onFocus={(e) => e.target.select()} />
          <Button onClick={async () => { await navigator.clipboard.writeText(secret!.value); toast('Copied'); }}>Copy</Button>
        </div>
      </Modal>
      <Modal open={!!deliveries} onClose={() => setDeliveries(null)} title="Delivery history">
        <DataTable rows={deliveries?.items ?? []} rowKey={(d) => d.id} empty="No deliveries yet" columns={[{ key: 'e', header: 'Event', render: (d) => d.event }, { key: 's', header: 'Status', render: (d) => <Badge tone={d.status === 'SENT' ? 'success' : d.status === 'FAILED' ? 'danger' : 'warning'}>{humanize(d.status)}</Badge> }, { key: 'r', header: 'HTTP', render: (d) => d.responseStatus ?? d.lastError ?? '—' }, { key: 'a', header: 'Attempts', render: (d) => d.attempts }, { key: 't', header: 'At', render: (d) => formatDateTime(d.createdAt) }]} />
      </Modal>
    </>
  );
}
