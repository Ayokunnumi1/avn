import type { Tx } from '@avn/database';
import { deps } from '../container';

export type After = (cb: () => Promise<void> | void) => void;

/**
 * Runs `fn` in a database transaction; callbacks registered with `after` run only once
 * the transaction has committed (notifications, webhooks, job dispatch), so side effects
 * never fire for rolled-back work.
 */
export async function withTx<T>(fn: (tx: Tx, after: After) => Promise<T>): Promise<T> {
  const callbacks: Array<() => Promise<void> | void> = [];
  const result = await deps().prisma.$transaction((tx) => fn(tx, (cb) => callbacks.push(cb)), { timeout: 20_000, maxWait: 10_000 });
  for (const cb of callbacks) {
    try {
      await cb();
    } catch (err) {
      deps().log.error({ err }, 'Post-commit callback failed');
    }
  }
  return result;
}
