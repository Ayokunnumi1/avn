'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, EmptyState, ErrorAlert, PageHeader, Spinner, formatDateTime, formatMoney, newIdempotencyKey, useApi, useToast, type ApiError } from '@avn/ui';
import { api } from '@/lib/api';
import { useDuty } from '@/components/duty';

interface Offer {
  id: string;
  generalLocation: string;
  walkingMinutes: number;
  distanceM: number;
  routingSource: string;
  level: string;
  priority: string;
  reward: string;
  currency: string;
  deadline: string | null;
  expiresAt: string;
}

export default function Jobs() {
  const router = useRouter();
  const toast = useToast();
  const duty = useDuty();
  const q = useApi<Offer[]>(api, '/verifiers/me/offers', { pollMs: 10000 });
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<ApiError>();
  async function accept(o: Offer) {
    setBusy(o.id);
    setError(undefined);
    try {
      const r = await api.post<{ assignmentId: string }>(`/offers/${o.id}/accept`, { idempotencyKey: newIdempotencyKey() });
      router.push(`/assignments/${r.assignmentId}`);
    } catch (e) {
      setError(e as ApiError);
      await q.reload();
    } finally {
      setBusy(undefined);
    }
  }
  async function decline(o: Offer) {
    setBusy(o.id);
    await api.post(`/offers/${o.id}/decline`, { reason: 'Not convenient' }).catch(() => undefined);
    toast('Offer declined');
    setBusy(undefined);
    await q.reload();
  }
  return (
    <>
      <PageHeader title="Job offers" subtitle="Only the general area is shown until you accept." />
      {!duty.available ? <Alert tone="info">Go available on the Home tab to receive nearby jobs.</Alert> : null}
      <ErrorAlert error={error} />
      {q.loading ? <Spinner /> : !q.data?.length ? (
        <EmptyState title="No offers right now" icon="briefcase">New jobs appear here automatically while you are on duty.</EmptyState>
      ) : (
        <div className="stack">
          {q.data.map((o) => (
            <Card key={o.id}>
              <div className="stack-sm">
                <div className="row between">
                  <strong>{o.generalLocation}</strong>
                  <span className="stat-value" style={{ fontSize: '1.3rem' }}>{formatMoney(o.reward, o.currency)}</span>
                </div>
                <div className="row small">
                  <Badge tone="primary">~{Math.round(o.walkingMinutes)} min walk</Badge>
                  <span>{(o.distanceM / 1000).toFixed(1)} km{o.routingSource === 'estimate' ? ' (estimate)' : ''}</span>
                  <Badge>{o.level}</Badge>
                  {o.priority !== 'NORMAL' ? <Badge tone="warning">{o.priority}</Badge> : null}
                </div>
                <div className="small muted">Complete by {formatDateTime(o.deadline)} · offer expires {formatDateTime(o.expiresAt)}</div>
                <div className="row">
                  <Button size="lg" style={{ flex: 1 }} loading={busy === o.id} onClick={() => void accept(o)}>Accept</Button>
                  <Button size="lg" variant="secondary" disabled={!!busy} onClick={() => void decline(o)}>Decline</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
