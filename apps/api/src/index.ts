import { createApp } from './app';
import { deps } from './container';
import { closeQueue } from './lib/jobs';

const { env, log, prisma, redis } = deps();
const app = createApp();
const server = app.listen(env.API_PORT, () => log.info({ port: env.API_PORT, env: env.APP_ENV, jobs: deps().jobsMode }, 'AVN API listening'));

async function shutdown(signal: string) {
  log.info({ signal }, 'Shutting down API');
  server.close();
  await closeQueue().catch(() => undefined);
  await redis?.quit().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
