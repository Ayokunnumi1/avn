import { PrismaClient, Prisma } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { __avnPrisma?: PrismaClient };

export function createPrismaClient(url?: string): PrismaClient {
  return new PrismaClient({
    datasources: url ? { db: { url } } : undefined,
    log: process.env.PRISMA_LOG === 'query' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

/** Process-wide singleton (avoids exhausting connections during hot reload). */
export const prisma: PrismaClient = globalForPrisma.__avnPrisma ?? createPrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.__avnPrisma = prisma;

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;
export { Prisma, PrismaClient } from '@prisma/client';
export * from '@prisma/client';
