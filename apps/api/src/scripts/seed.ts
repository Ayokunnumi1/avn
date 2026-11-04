export {};
/**
 * Local development seed (spec Part 15). Refuses to run in production.
 * Usage: pnpm db:seed   (or pnpm db:reset to wipe and reseed)
 * Every record is clearly labelled as fictional.
 */
process.env.JOBS_MODE = 'inline';
process.env.DISABLE_RATE_LIMITS = 'true';
// The seed drives the app in-process over plain HTTP; with an https:// public URL the session
// cookies would be marked Secure and never sent back, so use a local URL for this process only.
process.env.API_PUBLIC_URL = 'http://localhost';

const { getEnv } = await import('@avn/config');
const env = getEnv();
if (env.APP_ENV === 'production') {
  console.error('Refusing to seed: APP_ENV=production. Seed data must never mix with production records.');
  process.exit(1);
}

const { prisma } = await import('@avn/database');
const { createApp } = await import('../app');
const f = await import('../testing/fixtures');
const { runScenario } = await import('../testing/scenario');

if (await prisma.user.findFirst({ where: { accountType: 'ADMIN' } })) {
  console.log('Database already seeded. Run `pnpm db:reset` to wipe and reseed.');
  process.exit(0);
}

console.log('Seeding reference data…');
await f.createReferenceData(prisma);
await f.createAdmin(prisma, 'super@avn.local', 'SUPER_ADMIN', 'Super Admin (fictional)');
await f.createAdmin(prisma, 'ops@avn.local', 'OPERATIONS', 'Operations Admin (fictional)');
await f.createAdmin(prisma, 'reviewer@avn.local', 'REVIEWER', 'Quality Reviewer (fictional)');
await f.createAdmin(prisma, 'finance@avn.local', 'FINANCE', 'Finance Admin (fictional)');

console.log('Seeding institutions…');
await f.createOrg(prisma, {
  legalName: 'Demo Bank Plc (Fictional)',
  reg: 'RC-000001',
  walletNaira: '500000.00',
  staff: [
    { email: 'owner@demobank.test', role: 'OWNER', name: 'Ngozi Owner (fictional)' },
    { email: 'admin@demobank.test', role: 'ADMINISTRATOR', name: 'Tunde Admin (fictional)' },
    { email: 'supervisor@demobank.test', role: 'SUPERVISOR', name: 'Amaka Supervisor (fictional)' },
    { email: 'officer@demobank.test', role: 'VERIFICATION_OFFICER', name: 'Bayo Officer (fictional)' },
    { email: 'finance@demobank.test', role: 'FINANCE_OFFICER', name: 'Chidi Finance (fictional)' },
    { email: 'auditor@demobank.test', role: 'AUDITOR', name: 'Funmi Auditor (fictional)' },
  ],
});
await f.createOrg(prisma, {
  legalName: 'Sample Microfinance Ltd (Fictional)',
  reg: 'RC-000002',
  walletNaira: '100000.00',
  staff: [
    { email: 'owner@samplemfb.test', role: 'OWNER', name: 'Ibrahim Owner (fictional)' },
    { email: 'officer@samplemfb.test', role: 'VERIFICATION_OFFICER', name: 'Kemi Officer (fictional)' },
  ],
});
await f.createOrg(prisma, { legalName: 'Pending Fintech (Fictional)', reg: 'RC-000003', status: 'PENDING_REVIEW', staff: [{ email: 'owner@pendingfintech.test', role: 'OWNER', name: 'Pending Owner (fictional)' }] });

console.log('Seeding applicants and 16 approved verifiers…');
for (let i = 1; i <= 4; i++) await f.createApplicant(prisma, i);
const hubs = [f.LAGOS.ikeja, f.LAGOS.yaba, f.LAGOS.surulere, f.LAGOS.lekki];
for (let i = 1; i <= 16; i++) await f.createVerifier(prisma, i, hubs[(i - 1) % 4]!);
await f.createVerifier(prisma, 17, f.LAGOS.ikeja, 'MANUAL_REVIEW');
await f.createVerifier(prisma, 18, f.LAGOS.yaba, 'MANUAL_REVIEW');

console.log('Running end-to-end scenarios through the real API (this generates genuine findings and PDF reports)…');
const app = createApp();
const bank = f.client(app, 'business');
await bank.login('officer@demobank.test');
const mfb = f.client(app, 'business');
await mfb.login('officer@samplemfb.test');

const done = [
  await runScenario({ app, prisma, business: bank, verifierEmail: 'verifier01@avn.local', target: { lat: 6.6031, lng: 3.3502 }, street: 'Allen Avenue (sample)', customerReference: 'DB-CUST-1001', applicantName: 'Adaeze Sample (fictional)', applicantPhone: '08020000001', seed: 1 }),
  await runScenario({ app, prisma, business: bank, verifierEmail: 'verifier02@avn.local', target: { lat: 6.5101, lng: 3.3702 }, street: 'Herbert Macaulay Way (sample)', customerReference: 'DB-CUST-1002', applicantName: 'Emeka Sample (fictional)', applicantPhone: '08020000002', absent: true, seed: 2 }),
  await runScenario({ app, prisma, business: bank, verifierEmail: 'verifier03@avn.local', target: { lat: 6.4995, lng: 3.3550 }, street: 'Adeniran Ogunsanya St (sample)', customerReference: 'DB-CUST-1003', applicantName: 'Yetunde Sample (fictional)', applicantPhone: '08020000003', arrivalOffsetLat: 0.0025, seed: 3 }),
  await runScenario({ app, prisma, business: mfb, verifierEmail: 'verifier04@avn.local', target: { lat: 6.4480, lng: 3.4710 }, street: 'Admiralty Way (sample)', customerReference: 'MFB-0001', applicantName: 'Musa Sample (fictional)', applicantPhone: '08020000004', seed: 4 }),
];
for (const d of done) console.log(`  ✓ ${d.requestId.slice(0, 8)} → ${d.status} (${d.outcome ?? 'n/a'})`);

const accepted = await runScenario({ app, prisma, business: bank, verifierEmail: 'verifier05@avn.local', target: { lat: 6.6050, lng: 3.3530 }, street: 'Obafemi Awolowo Way (sample)', customerReference: 'DB-CUST-1004', applicantName: 'Halima Sample (fictional)', applicantPhone: '08020000005', seed: 5, stopAfter: 'accepted' });
await prisma.verifierAvailability.updateMany({ data: { isAvailable: false, sessionId: null, lastLat: null, lastLng: null } });
console.log(`  ✓ ${accepted.requestId.slice(0, 8)} → accepted, visit pending (log in as verifier05@avn.local to continue)`);
const ready = await runScenario({ app, prisma, business: bank, verifierEmail: 'verifier06@avn.local', target: { lat: 6.5990, lng: 3.3480 }, street: 'Opebi Road (sample)', customerReference: 'DB-CUST-1005', applicantName: 'Segun Sample (fictional)', applicantPhone: '08020000006', seed: 6, stopAfter: 'submitted' });
console.log(`  ✓ ${ready.requestId.slice(0, 8)} → waiting for a verifier (run \`pnpm --filter @avn/api simulate:verifiers\` or go available in the Agent app)`);
const pending = [];
for (let i = 7; i <= 9; i++) {
  pending.push(await runScenario({ app, prisma, business: bank, verifierEmail: '', target: f.LAGOS.ikeja, street: 'n/a', customerReference: `DB-CUST-10${i}`, applicantName: `Invited Applicant ${i} (fictional)`, applicantPhone: `0802000000${i}`, seed: i, stopAfter: 'created' }));
}

// Individual (B2C) request awaiting payment for applicant01.
const applicant = f.client(app, 'applicant');
await applicant.login('applicant01@avn.local');
const ind = await applicant.post('/me/requests', { level: 'STANDARD', purpose: 'TENANCY', fullName: 'Sample Applicant 01 (fictional)', address: f.sampleAddress({ lat: 6.5110, lng: 3.3690 }, 'Commercial Avenue (sample)', 'Yaba', 'Lagos Mainland'), consent: f.consent });
console.log(`  ✓ individual request ${ind.body.reference} created (awaiting payment)`);

// A pending payout for the finance approval queue.
const v1 = f.client(app, 'verifier');
await v1.login('verifier01@avn.local');
await v1.post('/verifiers/me/payouts', { amount: '1000.00', idempotencyKey: 'seed-payout-verifier01' });

console.log('\nSeed complete. Demo credentials (password for all: ' + f.DEMO_PASSWORD + '):');
console.table([
  { app: 'Admin (3003)', login: 'super@avn.local / finance@avn.local / reviewer@avn.local / ops@avn.local' },
  { app: 'Business (3002)', login: 'owner@demobank.test, officer@demobank.test, auditor@demobank.test …' },
  { app: 'Agent (3001)', login: 'verifier01@avn.local … verifier16@avn.local' },
  { app: 'User (3000)', login: 'applicant01@avn.local (or phone OTP: 08010000001)' },
]);
console.log('Invitation links (open in the User app):');
for (const p of pending) console.log(`  ${'invitationUrl' in p ? p.invitationUrl : ''}`);
await prisma.$disconnect();
process.exit(0);
