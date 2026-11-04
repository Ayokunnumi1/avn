'use client';
import { useState } from 'react';
import { Badge, Button, Card, DataTable, ErrorAlert, Modal, PageHeader, SelectInput, TextInput, humanize, useAction, useApi, useToast } from '@avn/ui';
import { api } from '@/lib/api';

interface Country { code: string; name: string; currency: string; timezone: string; phonePrefix: string; active: boolean }
interface Area { id: string; type: string; name: string; parentId: string | null; serviceActive: boolean; maxWalkingMinutes: number | null; centerLat: number | null; centerLng: number | null; verifiersWithin5km: number }

export default function Page() {
  const toast = useToast();
  const countries = useApi<Country[]>(api, '/admin/geo/countries');
  const [cc, setCc] = useState('NG');
  const areas = useApi<Area[]>(api, `/admin/geo/areas?countryCode=${cc}`);
  const [editC, setEditC] = useState<Country | null>(null);
  const [editA, setEditA] = useState<Partial<Area> | null>(null);
  const saveC = useAction(async () => { await api.put('/admin/geo/countries', editC); setEditC(null); toast('Country saved'); await countries.reload(); });
  const saveA = useAction(async () => {
    await api.put('/admin/geo/areas', { id: editA!.id, countryCode: cc, type: editA!.type, name: editA!.name, parentId: editA!.parentId ?? undefined, serviceActive: editA!.serviceActive ?? true, maxWalkingMinutes: editA!.maxWalkingMinutes ?? undefined, centerLat: editA!.centerLat ?? undefined, centerLng: editA!.centerLng ?? undefined });
    setEditA(null);
    toast('Area saved');
    await areas.reload();
  });
  const nameOf = (id: string | null) => areas.data?.find((a) => a.id === id)?.name ?? '—';
  return (
    <>
      <PageHeader title="Geography & coverage" subtitle="Countries, currencies, administrative areas, service coverage and verifier density." />
      <Card title="Countries" actions={<Button size="sm" onClick={() => setEditC({ code: '', name: '', currency: '', timezone: '', phonePrefix: '+', active: false })}>Add country</Button>}>
        <DataTable rows={countries.data ?? []} rowKey={(c) => c.code} columns={[{ key: 'c', header: 'Code', render: (c) => c.code }, { key: 'n', header: 'Name', render: (c) => c.name }, { key: 'cur', header: 'Currency', render: (c) => c.currency }, { key: 't', header: 'Timezone', render: (c) => c.timezone }, { key: 'p', header: 'Phone', render: (c) => c.phonePrefix }, { key: 's', header: 'Service', render: (c) => (c.active ? <Badge tone="success">Live</Badge> : <Badge>Planned</Badge>) }, { key: 'x', header: '', render: (c) => <Button size="sm" variant="secondary" onClick={() => setEditC(c)}>Edit</Button> }]} />
      </Card>
      <Card title="Administrative areas" actions={<><div style={{ width: 160 }}><SelectInput label="Country" value={cc} onChange={(e) => setCc(e.target.value)} options={(countries.data ?? []).map((c) => ({ value: c.code, label: c.name }))} /></div><Button size="sm" onClick={() => setEditA({ type: 'STATE', name: '', serviceActive: true })}>Add area</Button></>}>
        <DataTable rows={areas.data ?? []} rowKey={(a) => a.id} empty="No areas" columns={[
          { key: 't', header: 'Type', render: (a) => humanize(a.type) },
          { key: 'n', header: 'Name', render: (a) => a.name },
          { key: 'p', header: 'Parent', render: (a) => nameOf(a.parentId) },
          { key: 's', header: 'Coverage', render: (a) => (a.serviceActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>) },
          { key: 'w', header: 'Max walk', render: (a) => (a.maxWalkingMinutes ? `${a.maxWalkingMinutes} min` : '—') },
          { key: 'd', header: 'Verifier density (5 km)', render: (a) => (a.centerLat != null ? a.verifiersWithin5km : '—') },
          { key: 'x', header: '', render: (a) => <Button size="sm" variant="secondary" onClick={() => setEditA(a)}>Edit</Button> },
        ]} />
      </Card>
      <Modal open={!!editC} onClose={() => setEditC(null)} title="Country">
        {editC ? <div className="stack">
          <TextInput label="ISO code" value={editC.code} maxLength={2} onChange={(e) => setEditC({ ...editC, code: e.target.value.toUpperCase() })} />
          <TextInput label="Name" value={editC.name} onChange={(e) => setEditC({ ...editC, name: e.target.value })} />
          <TextInput label="Currency (ISO 4217)" value={editC.currency} maxLength={3} onChange={(e) => setEditC({ ...editC, currency: e.target.value.toUpperCase() })} />
          <TextInput label="Timezone (IANA)" value={editC.timezone} onChange={(e) => setEditC({ ...editC, timezone: e.target.value })} />
          <TextInput label="Phone prefix" value={editC.phonePrefix} onChange={(e) => setEditC({ ...editC, phonePrefix: e.target.value })} />
          <SelectInput label="Service" value={editC.active ? 'yes' : 'no'} onChange={(e) => setEditC({ ...editC, active: e.target.value === 'yes' })} options={[{ value: 'yes', label: 'Live' }, { value: 'no', label: 'Planned' }]} />
          <ErrorAlert error={saveC.error} />
          <Button loading={saveC.pending} onClick={() => void saveC.run()}>Save</Button>
        </div> : null}
      </Modal>
      <Modal open={!!editA} onClose={() => setEditA(null)} title="Administrative area">
        {editA ? <div className="stack">
          <SelectInput label="Type" value={editA.type ?? 'STATE'} onChange={(e) => setEditA({ ...editA, type: e.target.value })} options={['STATE', 'LGA', 'CITY'].map((t) => ({ value: t, label: humanize(t) }))} />
          <TextInput label="Name" value={editA.name ?? ''} onChange={(e) => setEditA({ ...editA, name: e.target.value })} />
          <SelectInput label="Parent" value={editA.parentId ?? ''} onChange={(e) => setEditA({ ...editA, parentId: e.target.value || null })} options={[{ value: '', label: 'None' }, ...(areas.data ?? []).filter((a) => a.id !== editA.id).map((a) => ({ value: a.id, label: `${a.name} (${humanize(a.type)})` }))]} />
          <SelectInput label="Coverage" value={editA.serviceActive === false ? 'no' : 'yes'} onChange={(e) => setEditA({ ...editA, serviceActive: e.target.value === 'yes' })} options={[{ value: 'yes', label: 'Active' }, { value: 'no', label: 'Inactive' }]} />
          <TextInput label="Max walking minutes" value={String(editA.maxWalkingMinutes ?? '')} onChange={(e) => setEditA({ ...editA, maxWalkingMinutes: Number(e.target.value) || null })} />
          <div className="grid grid-2">
            <TextInput label="Centre latitude" value={String(editA.centerLat ?? '')} onChange={(e) => setEditA({ ...editA, centerLat: e.target.value ? Number(e.target.value) : null })} />
            <TextInput label="Centre longitude" value={String(editA.centerLng ?? '')} onChange={(e) => setEditA({ ...editA, centerLng: e.target.value ? Number(e.target.value) : null })} />
          </div>
          <ErrorAlert error={saveA.error} />
          <Button loading={saveA.pending} disabled={!editA.name} onClick={() => void saveA.run()}>Save</Button>
        </div> : null}
      </Modal>
    </>
  );
}
