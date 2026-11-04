import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/** Walks up from cwd to find the monorepo root `.env` so every app shares one file in development. */
function loadEnvFile(): void {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate, quiet: true });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');
const csv = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []));

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    API_PORT: z.coerce.number().int().positive().default(4000),
    API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
    CORS_ORIGINS: csv,
    TRUST_PROXY: bool,

    APPLICANT_APP_URL: z.string().url().default('http://localhost:3000'),
    VERIFIER_APP_URL: z.string().url().default('http://localhost:3001'),
    BUSINESS_APP_URL: z.string().url().default('http://localhost:3002'),
    ADMIN_APP_URL: z.string().url().default('http://localhost:3003'),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().default('redis://localhost:6379'),

    SESSION_SECRET: z.string().min(32),
    REPORT_SIGNING_SECRET: z.string().min(32),
    STORAGE_SIGNING_SECRET: z.string().min(32),
    DATA_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'DATA_ENCRYPTION_KEY must be 32 bytes hex'),

    OTP_DEV_ECHO: bool,

    SMS_PROVIDER: z.enum(['console', 'termii']).default('console'),
    TERMII_API_KEY: z.string().optional(),
    TERMII_SENDER_ID: z.string().default('AVN'),
    EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
    SMTP_URL: z.string().optional(),
    EMAIL_FROM: z.string().default('AVN <no-reply@avn.local>'),
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().default('mailto:ops@avn.local'),

    PAYMENT_PROVIDER: z.enum(['simulator', 'paystack']).default('simulator'),
    PAYOUT_PROVIDER: z.enum(['simulator', 'paystack']).default('simulator'),
    PAYSTACK_SECRET_KEY: z.string().optional(),
    PAYSTACK_BASE_URL: z.string().url().default('https://api.paystack.co'),

    IDENTITY_PROVIDER: z.enum(['manual', 'simulator']).default('manual'),

    AI_PROVIDER: z.enum(['disabled', 'anthropic']).default('disabled'),
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_MODEL_TEXT: z.string().default('claude-opus-5-5'),
    AI_MODEL_VISION: z.string().default('claude-opus-5-5'),
    AI_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(50),
    AI_MAX_TOKENS: z.coerce.number().int().positive().default(1024),
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),

    GEOCODER_PROVIDER: z.enum(['nominatim', 'disabled']).default('nominatim'),
    NOMINATIM_URL: z.string().url().default('https://nominatim.openstreetmap.org'),
    ROUTING_PROVIDER: z.enum(['valhalla', 'estimate']).default('estimate'),
    VALHALLA_URL: z.string().url().default('https://valhalla1.openstreetmap.de'),

    STORAGE_DRIVER: z.enum(['local']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage-data'),
    MAX_UPLOAD_MB: z.coerce.number().positive().default(12),

    ADMIN_IP_ALLOWLIST: csv,
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV !== 'production') return;
    const fail = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (env.PAYMENT_PROVIDER === 'simulator') fail('PAYMENT_PROVIDER', 'Payment simulator is not allowed in production');
    if (env.PAYOUT_PROVIDER === 'simulator') fail('PAYOUT_PROVIDER', 'Payout simulator is not allowed in production');
    if (env.IDENTITY_PROVIDER === 'simulator') fail('IDENTITY_PROVIDER', 'Identity simulator is not allowed in production');
    if (env.OTP_DEV_ECHO) fail('OTP_DEV_ECHO', 'OTP echo must be disabled in production');
    if (env.SMS_PROVIDER === 'console') fail('SMS_PROVIDER', 'Console SMS is not allowed in production');
    if (env.SESSION_SECRET.startsWith('dev-only')) fail('SESSION_SECRET', 'Development secret used in production');
    if (env.REPORT_SIGNING_SECRET.startsWith('dev-only')) fail('REPORT_SIGNING_SECRET', 'Development secret used in production');
    if (env.STORAGE_SIGNING_SECRET.startsWith('dev-only')) fail('STORAGE_SIGNING_SECRET', 'Development secret used in production');
    if (/^0+$/.test(env.DATA_ENCRYPTION_KEY)) fail('DATA_ENCRYPTION_KEY', 'Development key used in production');
  })
  .superRefine((env, ctx) => {
    const need = (cond: boolean, path: string, message: string) => {
      if (cond) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    };
    need(env.PAYMENT_PROVIDER === 'paystack' && !env.PAYSTACK_SECRET_KEY, 'PAYSTACK_SECRET_KEY', 'Required for Paystack');
    need(env.PAYOUT_PROVIDER === 'paystack' && !env.PAYSTACK_SECRET_KEY, 'PAYSTACK_SECRET_KEY', 'Required for Paystack payouts');
    need(env.SMS_PROVIDER === 'termii' && !env.TERMII_API_KEY, 'TERMII_API_KEY', 'Required for Termii SMS');
    need(env.EMAIL_PROVIDER === 'smtp' && !env.SMTP_URL, 'SMTP_URL', 'Required for SMTP email');
    need(env.AI_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY', 'Required for Anthropic AI');
  });

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/** Parses and validates process.env once. Throws a readable error listing every invalid variable. */
export function getEnv(overrides: Record<string, string | undefined> = {}): Env {
  if (cached && Object.keys(overrides).length === 0) return cached;
  loadEnvFile();
  const parsed = EnvSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  if (Object.keys(overrides).length === 0) cached = parsed.data;
  return parsed.data;
}

export function resetEnvCache(): void {
  cached = undefined;
}

export const isProduction = (env: Env) => env.APP_ENV === 'production';
