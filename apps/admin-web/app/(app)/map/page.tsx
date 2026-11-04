'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Badge, Card, PageHeader, Spinner, StatusBadge, timeAgo, useApi } from '@avn/ui';
import { api } from '@/lib/api';

const MapView = dynamic(() => import('@avn/ui/map').then((m) => m.MapView), { ssr: false });
interface MapData { jobs: Array<{ id: string; reference: string; status: string; lat: number; lng: number; city: string; riskFlagged: boolean }>; verifiers: Array<{ id: string; name: string; lat: number; lng: number; accuracyM: number | null; lastHeartbeatAt: string }> }

export default function Page() {
  const q = useApi<MapData>(api, '/admin/map', { pollMs: 15000 });
  if (q.loading) return <Spinner />;
  const d = q.data!;
  const markers = [
    ...d.jobs.map((j) => ({ id: j.id, lat: j.lat, lng: j.lng, label: `${j.reference} · ${j.status}`, color: j.riskFlagged ? '#b42318' : '#b54708' })),
    ...d.verifiers.map((v) => ({ id: `v-${v.id}`, lat: v.lat, lng: v.lng, label: `${v.name} · ${timeAgo(v.lastHeartbeatAt)}`, color: '#0f766e' })),
  ];
  return (
    <>
      <PageHeader title="Live operations map" subtitle="Open jobs (amber, red = risk) and on-duty verifiers with a fresh heartbeat (teal). Stale positions are never shown." />
      <Card>
        <MapView center={markers[0] ?? { lat: 6.5244, lng: 3.3792 }} zoom={12} markers={markers} fitToContent={markers.length > 1} className="map tall" ariaLabel="Live map of jobs and verifiers" />
        <div className="row small" style={{ marginTop: 10 }}><Badge tone="warning">{d.jobs.length} open jobs</Badge><Badge tone="success">{d.verifiers.length} verifiers on duty</Badge></div>
      </Card>
      <Card title="Open jobs">
        <div className="stack-sm">{d.jobs.slice(0, 50).map((j) => <Link key={j.id} href={`/requests/${j.id}`} className="row" style={{ color: 'inherit' }}><span className="mono small">{j.reference}</span><StatusBadge status={j.status} /><span className="small muted">{j.city}</span></Link>)}</div>
      </Card>
    </>
  );
}
