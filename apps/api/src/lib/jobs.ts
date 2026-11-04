import { Queue } from 'bullmq';
import { deps } from '../container';

/**
 * Background jobs. In `queue` mode jobs go to BullMQ and run in the separate worker
 * process. If Redis is unavailable the enqueue is skipped and the worker's maintenance
 * sweep recovers the work from database state (outbox pattern), so no work is lost.
 * `inline` mode (tests, single-process demos) runs handlers immediately.
 */
export type JobName =
  | 'notifications.deliver'
  | 'dispatch.run'
  | 'webhooks.deliver'
  | 'reports.generate'
  | 'ai.evidence'
  | 'ai.document'
  | 'bulk.process'
  | 'payouts.process'
  | 'maintenance.tick';

type Handler = (data: Record<string, unknown>) => Promise<void>;
const handlers = new Map<JobName, Handler>();
export const QUEUE_NAME = 'avn-jobs';
let queue: Queue | null = null;

export function registerJob<T extends Record<string, unknown>>(name: JobName, handler: (data: T) => Promise<void>): void {
  handlers.set(name, handler as Handler);
}
export function jobHandler(name: JobName): Handler | undefined {
  return handlers.get(name);
}

function getQueue(): Queue | null {
  const { redis } = deps();
  if (!redis) return null;
  if (!queue) queue = new Queue(QUEUE_NAME, { connection: redis, defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000, removeOnFail: 5000 } });
  return queue;
}

export async function enqueue(name: JobName, data: Record<string, unknown>, opts: { delayMs?: number; jobId?: string } = {}): Promise<void> {
  const { jobsMode, log, redis } = deps();
  if (jobsMode === 'inline') {
    const h = handlers.get(name);
    if (!h) return;
    try {
      await h(data);
    } catch (err) {
      log.error({ err, job: name }, 'Inline job failed');
    }
    return;
  }
  const q = getQueue();
  if (!q || redis?.status !== 'ready') {
    log.warn({ job: name }, 'Queue unavailable; work will be recovered by the maintenance sweep');
    return;
  }
  try {
    await q.add(name, data, { delay: opts.delayMs, jobId: opts.jobId });
  } catch (err) {
    log.warn({ err, job: name }, 'Enqueue failed; relying on maintenance sweep');
  }
}

export async function closeQueue(): Promise<void> {
  await queue?.close();
  queue = null;
}
