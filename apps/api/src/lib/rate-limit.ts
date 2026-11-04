import type { NextFunction, Request, Response } from 'express';
import { RateLimiterMemory, RateLimiterRedis, type RateLimiterAbstract, RateLimiterRes } from 'rate-limiter-flexible';
import { deps } from '../container';
import { tooMany } from './errors';

/**
 * Rate limiting backed by Redis when available, with an in-memory insurance limiter so
 * limits still apply (per instance) if Redis goes down.
 */
const limiters = new Map<string, RateLimiterAbstract>();
function limiter(name: string, points: number, durationSec: number): RateLimiterAbstract {
  const key = `${name}:${points}:${durationSec}`;
  let l = limiters.get(key);
  if (!l) {
    const memory = new RateLimiterMemory({ keyPrefix: `rl_${name}`, points, duration: durationSec });
    const redis = deps().redis;
    l = redis
      ? new RateLimiterRedis({ storeClient: redis, keyPrefix: `rl_${name}`, points, duration: durationSec, insuranceLimiter: memory, useRedisPackage: false })
      : memory;
    limiters.set(key, l);
  }
  return l;
}

export async function consume(name: string, key: string, points: number, durationSec: number): Promise<void> {
  if (process.env.DISABLE_RATE_LIMITS === 'true') return;
  try {
    await limiter(name, points, durationSec).consume(key);
  } catch (err) {
    if (err instanceof RateLimiterRes) throw tooMany();
    throw err;
  }
}

export const rateLimit =
  (name: string, points: number, durationSec: number, keyFn: (req: Request) => string = (req) => req.ip ?? 'unknown') =>
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      await consume(name, keyFn(req), points, durationSec);
      next();
    } catch (err) {
      next(err);
    }
  };
