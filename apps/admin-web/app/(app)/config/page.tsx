'use client';
import { useEffect, useState } from 'react';
import { UNAVAILABILITY_FALLBACKS, type PlatformConfig } from '@avn/contracts';
import { Button, Card, Checkbox, DataTable, ErrorAlert, Modal, PageHeader, SelectInput, Spinner, TextInput, formatMoney, humanize, useAction, useApi, useAuth, useToast } from '@avn/ui';
import { api } from '@/lib/api';

interface Plan { id: string; countryCode: string; level: string; audience: string; price: string; verifierReward: string; bulkThreshold: number; bulkPrice: string | null; slaHours: number; active: boolean }

const NUM_FIELDS: Array<[keyof PlatformConfig, string, string]> = [
  ['arrivalThresholdM', 'Arrival threshold (m)', 'Default 50 m'],
  ['maxGpsAccuracyM', 'Acceptable GPS accuracy (m)', 'Worse accuracy is flagged, never auto-rejected'],
  ['heartbeatExpirySeconds', 'Location heartbeat expiry (s)', 'Verifier auto-unavailable after this'],
  ['assignmentOfferSeconds', 'Assignment offer expiry (s)', ''],
  ['invitationsPerTier', 'Verifiers invited per tier', ''],
  ['earningsHoldHours', 'Earnings approval hold (h)', '0 releases immediately after processing'],
  ['minimumPayout', 'Minimum payout (NGN)', ''],
  ['locationRetentionDays', 'Location history retention (days)', 'Data minimisation'],
];

export default function Page() {
  const toast = useToast();
  const { can } = useAuth();
  const cfg = useApi<PlatformConfig>(api, '/admin/config/platform');
  const plans = useApi<Plan[]>(api, '/admin/pricing');
  const [draft, setDraft] = useState<PlatformConfig | null>(null);
  const [tiers, setTiers] = useState('');
  const [password, setPassword] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  useEffect(() => {
    if (cfg.data) {
      setDraft(cfg.data);
      setTiers(cfg.data.walkingTiersMinutes.join(', '));
    }
  }, [cfg.data]);
  const save = useAction(async () => {
    await api.put('/admin/config/platform', { ...draft, walkingTiersMinutes: tiers.split(',').map((t) => Number(t.trim())).filter(Boolean), confirmPassword: password });
    setPassword('');
    toast('Configuration saved and audited');
    await cfg.reload();
  });
  const savePlan = useAction(async () => {
    await api.put('/admin/pricing', { ...plan, price: plan!.price, verifierReward: plan!.verifierReward, bulkPrice: plan!.bulkPrice || undefined });
    setPlan(null);
    toast('Pricing updated');
    await plans.reload();
  });
  if (!draft) return <Spinner />;
  const editable = can('config.manage');
  return (
    <>
      <PageHeader title="Platform configuration" subtitle="All changes are audited with before/after values." />
      <Card title="Assignment & field rules">
        <div className="stack">
          <div className="grid grid-2">
            {NUM_FIELDS.map(([k, label, hint]) => <TextInput key={k} label={label} hint={hint} disabled={!editable} inputMode="decimal" value={String(draft[k])} onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value.replace(/[^\d.]/g, '') || 0) })} />)}
            <TextInput label="Walking-time search tiers (minutes)" hint="Ascending, e.g. 15, 20, 30, 45" disabled={!editable} value={tiers} onChange={(e) => setTiers(e.target.value)} />
            <TextInput label="Default verifier reward share" hint="Used when a pricing plan has no explicit reward" disabled={!editable} value={String(draft.verifierRewardShare)} onChange={(e) => setDraft({ ...draft, verifierRewardShare: Number(e.target.value) || 0 })} />
          </div>
          <div className="field"><span className="label">Offered when no verifier is within reach</span>
            {UNAVAILABILITY_FALLBACKS.map((f) => <Checkbox key={f} label={humanize(f)} checked={draft.unavailabilityFallbacks.includes(f)} onChange={(v) => setDraft({ ...draft, unavailabilityFallbacks: v ? [...draft.unavailabilityFallbacks, f] : draft.unavailabilityFallbacks.filter((x) => x !== f) })} />)}
          </div>
          {editable ? (
            <div className="row">
              <TextInput label="Confirm your password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button style={{ alignSelf: 'flex-end' }} loading={save.pending} disabled={!password} onClick={() => void save.run()}>Save configuration</Button>
            </div>
          ) : null}
          <ErrorAlert error={save.error} />
        </div>
      </Card>
      <Card title="Verification pricing & agent rewards">
        <DataTable rows={plans.data ?? []} rowKey={(p) => p.id} columns={[
          { key: 'c', header: 'Country', render: (p) => p.countryCode },
          { key: 'a', header: 'Audience', render: (p) => humanize(p.audience) },
          { key: 'l', header: 'Level', render: (p) => p.level },
          { key: 'p', header: 'Price', render: (p) => formatMoney(p.price) },
          { key: 'r', header: 'Agent reward', render: (p) => formatMoney(p.verifierReward) },
          { key: 'b', header: 'Bulk', render: (p) => (p.bulkPrice ? `${formatMoney(p.bulkPrice)} ≥ ${p.bulkThreshold}/mo` : '—') },
          { key: 's', header: 'SLA', render: (p) => `${p.slaHours} h` },
          { key: 'x', header: '', render: (p) => (can('finance.manage') ? <Button size="sm" variant="secondary" onClick={() => setPlan({ ...p, price: String(p.price), verifierReward: String(p.verifierReward), bulkPrice: p.bulkPrice ? String(p.bulkPrice) : '' })}>Edit</Button> : null) },
        ]} />
      </Card>
      <Modal open={!!plan} onClose={() => setPlan(null)} title={plan ? `${humanize(plan.audience)} · ${plan.level}` : ''}>
        {plan ? (
          <div className="stack">
            <TextInput label="Price" value={plan.price} onChange={(e) => setPlan({ ...plan, price: e.target.value })} />
            <TextInput label="Verifier reward" value={plan.verifierReward} onChange={(e) => setPlan({ ...plan, verifierReward: e.target.value })} />
            <TextInput label="Bulk threshold (requests/month)" value={String(plan.bulkThreshold)} onChange={(e) => setPlan({ ...plan, bulkThreshold: Number(e.target.value) || 0 })} />
            <TextInput label="Bulk price" value={plan.bulkPrice ?? ''} onChange={(e) => setPlan({ ...plan, bulkPrice: e.target.value })} />
            <TextInput label="SLA (hours)" value={String(plan.slaHours)} onChange={(e) => setPlan({ ...plan, slaHours: Number(e.target.value) || 1 })} />
            <SelectInput label="Active" value={plan.active ? 'yes' : 'no'} onChange={(e) => setPlan({ ...plan, active: e.target.value === 'yes' })} options={[{ value: 'yes', label: 'Active' }, { value: 'no', label: 'Inactive' }]} />
            <ErrorAlert error={savePlan.error} />
            <Button loading={savePlan.pending} onClick={() => void savePlan.run()}>Save pricing</Button>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
