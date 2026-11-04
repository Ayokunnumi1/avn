/**
 * AVN background worker — a separate process from the API (spec §8.1).
 * Consumes the BullMQ queue (notifications, dispatch, webhooks, reports, AI, bulk, payouts)
 * and runs the maintenance sweep every 30 seconds. The sweep runs on a local timer, so the
 * worker keeps recovering work from the database even while Redis is unavailable.
 */
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { deps } from '@avn/api/container';
import { jobHandler, maintenanceTick, QUEUE_NAME, type JobName } from '@avn/api/jobs';

const { env, log, prisma } = deps();
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', (err) => log.warn({ err: err.message }, 'Worker: Redis unavailable — continuing with database sweeps'));

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const handler = jobHandler(job.name as JobName);
    if (!handler) throw new Error(`No handler registered for job ${job.name}`);
    await handler(job.data as Record<string, unknown>);
  },
  { connection, concurrency: 8 },
);
worker.on('completed', (job) => log.debug({ job: job.name, id: job.id }, 'Job completed'));
worker.on('failed', (job, err) => log.warn({ job: job?.name, id: job?.id, attempts: job?.attemptsMade, err: err.message }, 'Job failed'));

let running = false;
const SWEEP_MS = 30_000;
const timer = setInterval(async () => {
  if (running) return;
  running = true;
  try {
    const stats = await maintenanceTick();
    if (Object.values(stats).some((v) => v > 0)) log.info({ stats }, 'Maintenance sweep');
  } catch (err) {
    log.error({ err }, 'Maintenance sweep failed');
  } finally {
    running = false;
  }
}, SWEEP_MS);

log.info({ queue: QUEUE_NAME, sweepSeconds: SWEEP_MS / 1000 }, 'AVN worker started');

async function shutdown(signal: string) {
  log.info({ signal }, 'Worker shutting down');
  clearInterval(timer);
  await worker.close().catch(() => undefined);
  await connection.quit().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
