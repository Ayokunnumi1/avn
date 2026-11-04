import { Prisma, type LedgerBucket, type LedgerCategory, type LedgerDirection, type Tx, type WalletOwnerType } from '@avn/database';
import { Decimal } from '@avn/shared-utils/money';
import { paymentRequired } from './errors';

/**
 * Auditable ledger (spec §10.2). Wallet balances change ONLY here, inside the caller's
 * transaction, with the wallet row locked and an immutable WalletTransaction appended.
 * Entries are idempotent on (wallet, reference, bucket, direction).
 */
export interface LedgerEntryInput {
  walletId: string;
  direction: LedgerDirection;
  bucket: LedgerBucket;
  category: LedgerCategory;
  amount: Decimal.Value;
  reference: string;
  description: string;
  requestId?: string;
  paymentId?: string;
  payoutId?: string;
  createdById?: string;
  /** For organisation wallets: how far below zero AVAILABLE may go (postpaid credit). */
  overdraftLimit?: Decimal.Value;
}

const FIELD: Record<LedgerBucket, 'pendingBalance' | 'availableBalance' | 'heldBalance'> = {
  PENDING: 'pendingBalance',
  AVAILABLE: 'availableBalance',
  HELD: 'heldBalance',
};

export async function postEntry(tx: Tx, e: LedgerEntryInput) {
  const amount = new Decimal(e.amount);
  if (amount.lte(0)) throw new Error('Ledger amounts must be positive');
  await tx.$queryRaw`SELECT id FROM "Wallet" WHERE id = ${e.walletId}::uuid FOR UPDATE`;

  const existing = await tx.walletTransaction.findUnique({
    where: { walletId_reference_bucket_direction: { walletId: e.walletId, reference: e.reference, bucket: e.bucket, direction: e.direction } },
  });
  if (existing) return existing; // idempotent replay

  const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: e.walletId } });
  const field = FIELD[e.bucket];
  const current = new Decimal(wallet[field].toString());
  const next = e.direction === 'CREDIT' ? current.plus(amount) : current.minus(amount);
  const floor = new Decimal(e.overdraftLimit ?? 0).negated();
  if (next.lt(floor)) throw paymentRequired(e.bucket === 'AVAILABLE' ? 'Insufficient wallet balance' : 'Insufficient balance');

  await tx.wallet.update({ where: { id: e.walletId }, data: { [field]: new Prisma.Decimal(next.toFixed(2)) } });
  return tx.walletTransaction.create({
    data: {
      walletId: e.walletId,
      direction: e.direction,
      bucket: e.bucket,
      category: e.category,
      amount: new Prisma.Decimal(amount.toFixed(2)),
      balanceAfter: new Prisma.Decimal(next.toFixed(2)),
      reference: e.reference,
      description: e.description,
      requestId: e.requestId,
      paymentId: e.paymentId,
      payoutId: e.payoutId,
      createdById: e.createdById,
    },
  });
}

export async function ensureWallet(tx: Tx, ownerType: WalletOwnerType, ownerId: string, currency = 'NGN') {
  const where = ownerType === 'VERIFIER' ? { verifierId: ownerId } : { organisationId: ownerId };
  const found = await tx.wallet.findFirst({ where });
  if (found) return found;
  return tx.wallet.create({ data: { ownerType, currency, ...where } });
}

/** Moves an amount between two buckets of the same wallet as a balanced pair of entries. */
export async function moveBetweenBuckets(
  tx: Tx,
  walletId: string,
  from: LedgerBucket,
  to: LedgerBucket,
  amount: Decimal.Value,
  category: LedgerCategory,
  reference: string,
  description: string,
  links: Pick<LedgerEntryInput, 'requestId' | 'payoutId' | 'createdById'> = {},
) {
  await postEntry(tx, { walletId, direction: 'DEBIT', bucket: from, category, amount, reference, description, ...links });
  await postEntry(tx, { walletId, direction: 'CREDIT', bucket: to, category, amount, reference, description, ...links });
}
