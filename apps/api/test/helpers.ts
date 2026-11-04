import type { Express } from 'express';
import { prisma } from '@avn/database';
import { createApp } from '../src/app';
import { clearSettingsCache } from '../src/lib/settings';
import { client, createAdmin, createApplicant, createOrg, createReferenceData, createVerifier, LAGOS } from '../src/testing/fixtures';

export { prisma };

/** Wipes every table (TRUNCATE bypasses the ledger's row-level immutability trigger) and reloads reference data. */
export async function resetDb() {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' AND tablename <> 'spatial_ref_sys'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  clearSettingsCache();
  await createReferenceData(prisma);
}

let app: Express | undefined;
export const getApp = () => (app ??= createApp());

/** A standard world: two approved banks with staff, admins, applicants and verifiers around Ikeja. */
export async function standardWorld() {
  await resetDb();
  const a = await createOrg(prisma, {
    legalName: 'Alpha Bank (Fictional)',
    reg: 'RC-A',
    walletNaira: '100000.00',
    staff: [
      { email: 'owner@alpha.test', role: 'OWNER', name: 'Alpha Owner' },
      { email: 'officer@alpha.test', role: 'VERIFICATION_OFFICER', name: 'Alpha Officer' },
      { email: 'auditor@alpha.test', role: 'AUDITOR', name: 'Alpha Auditor' },
      { email: 'finance@alpha.test', role: 'FINANCE_OFFICER', name: 'Alpha Finance' },
    ],
  });
  const b = await createOrg(prisma, { legalName: 'Beta Bank (Fictional)', reg: 'RC-B', walletNaira: '100000.00', staff: [{ email: 'owner@beta.test', role: 'OWNER', name: 'Beta Owner' }] });
  await createAdmin(prisma, 'super@avn.local', 'SUPER_ADMIN', 'Super');
  await createAdmin(prisma, 'ops@avn.local', 'OPERATIONS', 'Ops');
  await createAdmin(prisma, 'finance@avn.local', 'FINANCE', 'Finance');
  await createAdmin(prisma, 'reviewer@avn.local', 'REVIEWER', 'Reviewer');
  for (let i = 1; i <= 2; i++) await createApplicant(prisma, i);
  const verifiers = [];
  for (let i = 1; i <= 4; i++) verifiers.push(await createVerifier(prisma, i, LAGOS.ikeja));
  const pending = await createVerifier(prisma, 9, LAGOS.ikeja, 'MANUAL_REVIEW');
  const appInstance = getApp();
  const alpha = client(appInstance, 'business');
  await alpha.login('officer@alpha.test');
  const beta = client(appInstance, 'business');
  await beta.login('owner@beta.test');
  return { app: appInstance, orgA: a, orgB: b, alpha, beta, verifiers, pending };
}
