import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { deps } from './container';
import { authenticate, csrfGuard } from './lib/auth';
import { errorHandler, notFound } from './lib/errors';
import { rateLimit } from './lib/rate-limit';
import './jobs';
import { authRoutes } from './modules/auth/routes';
import { apiUsageLogger } from './modules/integrations/public';
import { buildOpenApi } from './openapi';
import { allRoutes } from './routes';

export function createApp(): Express {
  const { env, log, prisma, redis } = deps();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY > 0 ? env.TRUST_PROXY : false);

  app.use(pinoHttp({ logger: log, genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(), autoLogging: { ignore: (req) => req.url === '/health' } }));
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.CORS_ORIGINS.includes(origin)),
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-AVN-App', 'Idempotency-Key', 'X-Request-Id'],
    }),
  );
  // Raw body retained for payment webhook signature verification.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());

  app.get('/health', async (_req, res) => {
    const db = await prisma.$queryRaw`SELECT 1`.then(() => 'ok').catch(() => 'down');
    res.status(db === 'ok' ? 200 : 503).json({ status: db === 'ok' ? 'ok' : 'degraded', db, redis: redis ? redis.status : 'disabled', time: new Date().toISOString() });
  });

  const openapi = () => buildOpenApi(env.API_PUBLIC_URL);
  app.get('/api/v1/openapi.json', (_req, res) => res.json(openapi()));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(undefined, { swaggerOptions: { url: '/api/v1/openapi.json' } }));

  const api = express.Router();
  api.use(rateLimit('global', 600, 60));
  api.use(authenticate);
  api.use(csrfGuard);
  api.use('/integrations', apiUsageLogger);
  for (const r of [authRoutes, ...allRoutes]) api.use(r.prefix, r.router);
  api.use((_req, _res, next) => next(notFound('Endpoint')));
  app.use('/api/v1', api);
  app.use(errorHandler);
  return app;
}
