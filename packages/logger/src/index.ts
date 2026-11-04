import pino, { type Logger } from 'pino';

/** Fields that must never be written to logs (PII, secrets, credentials). */
export const REDACT_PATHS = [
  'password',
  'passwordHash',
  'otp',
  'code',
  'token',
  'secret',
  'apiKey',
  'authorization',
  'cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.otp',
  '*.token',
  '*.secret',
  '*.accountNumber',
];

export function createLogger(name: string, level = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino({
    name,
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: name, env: process.env.APP_ENV ?? 'development' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type { Logger };
