import { createApp } from './app';
import { deps } from './container';
import { closeQueue } from './lib/jobs';
import { maintenanceTick } from './jobs';

const { env, log, prisma, redis } = deps();
const app = createApp();
const server = app.listen(env.API_PORT, () => log.info({ port: env.API_PORT, env: env.APP_ENV, jobs: deps().jobsMode }, 'AVN API listening'));

// Single-process deployments (JOBS_MODE=inline, no worker) run the maintenance sweep here.
let sweeping = false;
const sweep =
  deps().jobsMode === 'inline' && process.env.APP_ENV !== 'test'
    ? setInterval(async () => {
        if (sweeping) return;
        sweeping = true;
        try {
          await maintenanceTick();
        } catch (err) {
          log.error({ err }, 'Maintenance sweep failed');
        } finally {
          sweeping = false;
        }
      }, 30_000)
    : null;

async function shutdown(signal: string) {
  if (sweep) clearInterval(sweep);
  log.info({ signal }, 'Shutting down API');
  server.close();
  await closeQueue().catch(() => undefined);
  await redis?.quit().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
