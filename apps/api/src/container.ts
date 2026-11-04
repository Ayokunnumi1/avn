import { Redis } from 'ioredis';
import { AnthropicAiProvider, DisabledAiProvider, type AiProvider } from '@avn/ai';
import { getEnv, type Env } from '@avn/config';
import { prisma, type PrismaClient } from '@avn/database';
import { createLogger, type Logger } from '@avn/logger';
import { DisabledGeocoder, EstimateRouter, NominatimGeocoder, ValhallaRouter, type Geocoder, type Router } from '@avn/maps';
import {
  ConsoleEmailProvider,
  ConsoleSmsProvider,
  SmtpEmailProvider,
  TermiiSmsProvider,
  WebPushProvider,
  type EmailProvider,
  type PushProvider,
  type SmsProvider,
} from '@avn/notifications';
import {
  PaystackPaymentProvider,
  PaystackPayoutProvider,
  SimulatorPaymentProvider,
  SimulatorPayoutProvider,
  type PaymentProvider,
  type PayoutProvider,
} from '@avn/payments';
import { LocalDiskStorage, NoopScanner, type MalwareScanner, type ObjectStorage } from '@avn/storage';

/**
 * Composition root. Every external dependency is constructed here behind its adapter
 * interface, selected purely from validated configuration. Tests override pieces via setDeps().
 */
export interface Deps {
  env: Env;
  log: Logger;
  prisma: PrismaClient;
  redis: Redis | null;
  payments: PaymentProvider;
  payouts: PayoutProvider;
  router: Router;
  geocoder: Geocoder;
  storage: ObjectStorage;
  scanner: MalwareScanner;
  sms: SmsProvider;
  email: EmailProvider;
  push: PushProvider;
  ai: AiProvider;
  jobsMode: 'queue' | 'inline';
}

let current: Deps | undefined;

export function buildDeps(overrides: Partial<Deps> = {}): Deps {
  const env = overrides.env ?? getEnv();
  const log = overrides.log ?? createLogger('avn-api', env.LOG_LEVEL);
  const jobsMode = (process.env.JOBS_MODE === 'inline' ? 'inline' : 'queue') as Deps['jobsMode'];

  let redis: Redis | null = null;
  if (jobsMode === 'queue' && overrides.redis === undefined) {
    redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableOfflineQueue: false, lazyConnect: false });
    redis.on('error', (err) => log.warn({ err: err.message }, 'Redis unavailable — falling back to database outbox sweeps'));
  }

  const logFn = (obj: Record<string, unknown>, msg: string) => log.info(obj, msg);
  const payments =
    env.PAYMENT_PROVIDER === 'paystack'
      ? new PaystackPaymentProvider(env.PAYSTACK_SECRET_KEY!, env.PAYSTACK_BASE_URL)
      : new SimulatorPaymentProvider(env.SESSION_SECRET, `${env.API_PUBLIC_URL}/api/v1/payments/simulator/checkout`);

  return {
    env,
    log,
    prisma,
    redis,
    payments,
    payouts: env.PAYOUT_PROVIDER === 'paystack' ? new PaystackPayoutProvider(env.PAYSTACK_SECRET_KEY!, env.PAYSTACK_BASE_URL) : new SimulatorPayoutProvider(),
    router:
      env.ROUTING_PROVIDER === 'valhalla'
        ? new ValhallaRouter(env.VALHALLA_URL, 6000, (err) => log.warn({ err: String(err) }, 'Pedestrian routing unavailable — using labelled estimate'))
        : new EstimateRouter(),
    geocoder: env.GEOCODER_PROVIDER === 'nominatim' ? new NominatimGeocoder(env.NOMINATIM_URL) : new DisabledGeocoder(),
    storage: new LocalDiskStorage(env.STORAGE_LOCAL_DIR),
    scanner: new NoopScanner(),
    sms: env.SMS_PROVIDER === 'termii' ? new TermiiSmsProvider(env.TERMII_API_KEY!, env.TERMII_SENDER_ID) : new ConsoleSmsProvider(logFn),
    email: env.EMAIL_PROVIDER === 'smtp' ? new SmtpEmailProvider(env.SMTP_URL!, env.EMAIL_FROM) : new ConsoleEmailProvider(logFn),
    push: new WebPushProvider(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT),
    ai: env.AI_PROVIDER === 'anthropic' ? new AnthropicAiProvider(env.ANTHROPIC_API_KEY!, { timeoutMs: env.AI_TIMEOUT_MS }) : new DisabledAiProvider(),
    jobsMode,
    ...overrides,
  };
}

export function deps(): Deps {
  if (!current) current = buildDeps();
  return current;
}

export function setDeps(d: Deps): void {
  current = d;
}
