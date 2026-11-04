'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Checkbox, PageHeader, Spinner, formatDateTime, humanize, useApi } from '@avn/ui';
import { api } from '@/lib/api';

interface E { id: string; requestId: string; reference: string; category: string; url: string; capturedAt: string; receivedAt: string; lat: number; lng: number; accuracyM: number; distanceFromTargetM: number | null; sha256: string; perceptualHash: string | null; duplicateOfId: string | null; deviceId: string }

export default function Page() {
  const [flagged, setFlagged] = useState(false);
  const q = useApi<E[]>(api, `/admin/evidence${flagged ? '?flagged=true' : ''}`);
  return (
    <>
      <PageHeader title="Evidence browser" subtitle="GPS records, timestamps (device vs server), hashes and duplicate flags." actions={<Checkbox label="Only flagged" checked={flagged} onChange={setFlagged} />} />
      {q.loading ? <Spinner /> : (
        <div className="evidence-grid">
          {(q.data ?? []).map((e) => (
            <figure key={e.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <a href={e.url} target="_blank" rel="noreferrer"><img src={e.url} alt={humanize(e.category)} loading="lazy" /></a>
              <figcaption>
                <Link href={`/requests/${e.requestId}`} className="mono">{e.reference}</Link> · {humanize(e.category)}<br />
                Device {formatDateTime(e.capturedAt)}<br />Server {formatDateTime(e.receivedAt)}<br />
                {e.lat.toFixed(5)}, {e.lng.toFixed(5)} ±{Math.round(e.accuracyM)} m · {e.distanceFromTargetM} m from pin<br />
                <span className="mono">sha {e.sha256.slice(0, 10)} · dhash {e.perceptualHash ?? '—'}</span>
                {e.duplicateOfId ? <><br /><Badge tone="danger">Duplicate</Badge></> : null}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </>
  );
}
