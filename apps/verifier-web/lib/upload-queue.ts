/**
 * Persistent evidence upload queue (spec §9.3 "resumable retry behaviour").
 * Captures are stored in IndexedDB until the server acknowledges them, so a dropped
 * connection, a reload or an app restart never loses field evidence. The server treats
 * re-uploads of the same file as idempotent.
 */
export interface QueuedEvidence {
  id: string;
  assignmentId: string;
  category: string;
  blob: Blob;
  meta: Record<string, string>;
  attempts: number;
  lastError?: string;
  createdAt: number;
}

const DB = 'avn-agent';
const STORE = 'evidence-queue';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const enqueue = (item: QueuedEvidence) => tx('readwrite', (s) => s.put(item));
export const remove = (id: string) => tx('readwrite', (s) => s.delete(id));
export const list = async (assignmentId?: string) => {
  const all = (await tx<QueuedEvidence[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedEvidence[]>)) ?? [];
  return assignmentId ? all.filter((x) => x.assignmentId === assignmentId) : all;
};

/** Attempts to upload every queued item for an assignment; returns server results. */
export async function flush(assignmentId: string, onResult: (item: QueuedEvidence, ok: boolean, body: unknown) => void): Promise<void> {
  for (const item of await list(assignmentId)) {
    const form = new FormData();
    for (const [k, v] of Object.entries(item.meta)) form.append(k, v);
    form.append('file', item.blob, `${item.category.toLowerCase()}.jpg`);
    try {
      const res = await fetch(`/api/v1/assignments/${assignmentId}/evidence`, { method: 'POST', body: form, headers: { 'X-AVN-App': 'verifier' }, credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        await remove(item.id);
        onResult(item, true, body);
      } else if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        // Permanent rejection (e.g. invalid file): drop it and tell the verifier.
        await remove(item.id);
        onResult(item, false, body);
      } else {
        await enqueue({ ...item, attempts: item.attempts + 1, lastError: `HTTP ${res.status}` });
      }
    } catch {
      await enqueue({ ...item, attempts: item.attempts + 1, lastError: 'Offline' });
    }
  }
}
