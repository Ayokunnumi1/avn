import sharp from 'sharp';
import request from 'supertest';
import type { Express } from 'express';
import { hashPassword } from '@avn/auth';
import { DEFAULT_PLATFORM_CONFIG, DEFAULT_POLICY_RULES, ORG_ROLE_PERMISSIONS, type AppAudience, type OrgRole } from '@avn/contracts';
import { Prisma, type PrismaClient } from '@avn/database';

/**
 * Shared fixtures for local seed data and integration tests. Everything created here is
 * clearly labelled fictional development data.
 */
export const DEMO_PASSWORD = 'AvnDemo2026!';

export const LAGOS = {
  ikeja: { lat: 6.6018, lng: 3.3515 },
  yaba: { lat: 6.5095, lng: 3.3711 },
  surulere: { lat: 6.5005, lng: 3.3537 },
  lekki: { lat: 6.4474, lng: 3.4723 },
  victoriaIsland: { lat: 6.4281, lng: 3.4219 },
};

export async function createReferenceData(prisma: PrismaClient) {
  await prisma.country.upsert({ where: { code: 'NG' }, create: { code: 'NG', name: 'Nigeria', currency: 'NGN', timezone: 'Africa/Lagos', phonePrefix: '+234' }, update: {} });
  await prisma.country.upsert({ where: { code: 'GH' }, create: { code: 'GH', name: 'Ghana', currency: 'GHS', timezone: 'Africa/Accra', phonePrefix: '+233', active: false }, update: {} });
  await prisma.country.upsert({ where: { code: 'KE' }, create: { code: 'KE', name: 'Kenya', currency: 'KES', timezone: 'Africa/Nairobi', phonePrefix: '+254', active: false }, update: {} });

  const area = async (type: 'STATE' | 'LGA' | 'CITY', name: string, parentId: string | null, c?: { lat: number; lng: number }) => {
    const found = await prisma.administrativeArea.findFirst({ where: { countryCode: 'NG', type, name, parentId } });
    return found ?? prisma.administrativeArea.create({ data: { countryCode: 'NG', type, name, parentId, centerLat: c?.lat, centerLng: c?.lng, maxWalkingMinutes: 45 } });
  };
  const lagos = await area('STATE', 'Lagos', null, { lat: 6.5244, lng: 3.3792 });
  for (const [lga, c] of [['Ikeja', LAGOS.ikeja], ['Lagos Mainland', LAGOS.yaba], ['Surulere', LAGOS.surulere], ['Eti-Osa', LAGOS.lekki]] as const) {
    const l = await area('LGA', lga, lagos.id, c);
    await area('CITY', lga === 'Lagos Mainland' ? 'Yaba' : lga === 'Eti-Osa' ? 'Lekki' : lga, l.id, c);
  }
  const fct = await area('STATE', 'FCT', null, { lat: 9.0765, lng: 7.3986 });
  const amac = await area('LGA', 'Abuja Municipal', fct.id, { lat: 9.0579, lng: 7.4951 });
  await area('CITY', 'Wuse', amac.id, { lat: 9.0643, lng: 7.4892 });
  for (const s of ['Ogun', 'Oyo', 'Rivers', 'Kano', 'Enugu', 'Kaduna']) await area('STATE', s, null);

  const plans: Array<[string, string, string, string, number, number | null, string | null]> = [
    ['INDIVIDUAL', 'BASIC', '3500.00', '1500.00', 72, null, null],
    ['INDIVIDUAL', 'STANDARD', '5000.00', '2000.00', 48, null, null],
    ['INDIVIDUAL', 'ENHANCED', '8500.00', '3500.00', 24, null, null],
    ['INSTITUTION', 'BASIC', '3000.00', '1500.00', 72, 100, '2700.00'],
    ['INSTITUTION', 'STANDARD', '4500.00', '2000.00', 48, 100, '4000.00'],
    ['INSTITUTION', 'ENHANCED', '7500.00', '3500.00', 24, 100, '6800.00'],
  ];
  for (const [audience, level, price, reward, sla, bulkThreshold, bulkPrice] of plans) {
    await prisma.pricingPlan.upsert({
      where: { countryCode_level_audience: { countryCode: 'NG', level: level as 'BASIC', audience } },
      create: { countryCode: 'NG', level: level as 'BASIC', audience, price: new Prisma.Decimal(price), verifierReward: new Prisma.Decimal(reward), slaHours: sla, bulkThreshold: bulkThreshold ?? 0, bulkPrice: bulkPrice ? new Prisma.Decimal(bulkPrice) : null },
      update: {},
    });
  }

  if (!(await prisma.verificationPolicy.findFirst({ where: { organisationId: null, isDefault: true } }))) {
    await prisma.verificationPolicy.create({ data: { name: 'Platform default', isDefault: true, versions: { create: { version: 1, rules: DEFAULT_POLICY_RULES, changeNote: 'Initial platform policy' } } } });
  }
  await prisma.platformSetting.upsert({ where: { key: 'platform' }, create: { key: 'platform', value: DEFAULT_PLATFORM_CONFIG }, update: {} });
  for (const [key, perms] of Object.entries(ORG_ROLE_PERMISSIONS)) {
    await prisma.organisationRole.upsert({ where: { key: key as OrgRole }, create: { key: key as OrgRole, name: key.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), description: `${key} role`, permissions: [...perms] }, update: { permissions: [...perms] } });
  }
}

let pwHash: string | undefined;
const demoHash = async () => (pwHash ??= await hashPassword(DEMO_PASSWORD));

export async function createAdmin(prisma: PrismaClient, email: string, role: 'SUPER_ADMIN' | 'OPERATIONS' | 'REVIEWER' | 'FINANCE' | 'SUPPORT', fullName: string) {
  return prisma.user.upsert({ where: { accountType_email: { accountType: 'ADMIN', email } }, create: { accountType: 'ADMIN', adminRole: role, email, fullName, passwordHash: await demoHash() }, update: {} });
}

export async function createOrg(prisma: PrismaClient, opts: { legalName: string; reg: string; status?: 'APPROVED' | 'PENDING_REVIEW'; staff: Array<{ email: string; role: OrgRole; name: string }>; walletNaira?: string }) {
  const org = await prisma.organisation.create({
    data: {
      legalName: opts.legalName,
      tradingName: opts.legalName.replace(/ \(Fictional\)/, ''),
      registrationNumber: opts.reg,
      businessType: 'BANK',
      contactEmail: opts.staff[0]!.email,
      contactPhone: '+2348000000000',
      address: '1 Example Way, Victoria Island, Lagos (fictional)',
      status: opts.status ?? 'APPROVED',
      approvedAt: opts.status === 'PENDING_REVIEW' ? null : new Date(),
      wallet: { create: { ownerType: 'ORGANISATION' } },
      policies: { create: { name: 'Standard residential', isDefault: true, versions: { create: { version: 1, rules: DEFAULT_POLICY_RULES, changeNote: 'Seed' } } } },
    },
    include: { wallet: true },
  });
  for (const s of opts.staff) {
    await prisma.user.create({ data: { accountType: 'INSTITUTION', email: s.email, fullName: s.name, passwordHash: await demoHash(), membership: { create: { organisationId: org.id, role: s.role } } } });
  }
  if (opts.walletNaira) {
    const ref = `SEED-TOPUP-${org.id.slice(0, 8)}`;
    const p = await prisma.payment.create({ data: { reference: ref, provider: 'simulator', purpose: 'WALLET_TOPUP', status: 'SUCCEEDED', amount: new Prisma.Decimal(opts.walletNaira), organisationId: org.id, paidAt: new Date(), reconciledAt: new Date() } });
    await prisma.wallet.update({ where: { id: org.wallet!.id }, data: { availableBalance: new Prisma.Decimal(opts.walletNaira) } });
    await prisma.walletTransaction.create({ data: { walletId: org.wallet!.id, direction: 'CREDIT', bucket: 'AVAILABLE', category: 'TOPUP', amount: new Prisma.Decimal(opts.walletNaira), balanceAfter: new Prisma.Decimal(opts.walletNaira), reference: `topup:${p.id}`, description: 'Seed top-up (simulated)', paymentId: p.id } });
  }
  return org;
}

export async function createVerifier(prisma: PrismaClient, n: number, near: { lat: number; lng: number }, status: 'APPROVED' | 'MANUAL_REVIEW' = 'APPROVED') {
  const id = String(n).padStart(2, '0');
  const user = await prisma.user.create({
    data: {
      accountType: 'VERIFIER',
      fullName: `Test Verifier ${id} (fictional)`,
      email: `verifier${id}@avn.local`,
      phone: `+23481100000${id}`,
      phoneVerifiedAt: new Date(),
      passwordHash: await demoHash(),
      verifierProfile: {
        create: {
          status,
          dateOfBirth: '1994-05-10',
          residentialAddress: 'Fictional address, Lagos',
          homeLat: near.lat + 0.03,
          homeLng: near.lng + 0.03,
          idType: 'NIN',
          idNumberLast4: `00${id}`,
          payoutBankCode: '058',
          payoutBankName: 'GTBank (simulated)',
          payoutAccountLast4: `12${id}`,
          payoutAccountName: `Test Verifier ${id}`,
          payoutRecipientCode: `SIMRCP_058_12${id}`,
          approvedAt: status === 'APPROVED' ? new Date() : null,
          identityChecks: { create: { provider: 'simulator', idType: 'NIN', status: status === 'APPROVED' ? 'PASSED' : 'MANUAL_REVIEW', resultSummary: { simulator: true, note: 'Seed data — not a real identity check' }, completedAt: new Date() } },
          wallet: { create: { ownerType: 'VERIFIER' } },
        },
      },
    },
    include: { verifierProfile: true },
  });
  return { user, verifier: user.verifierProfile!, home: near };
}

export async function createApplicant(prisma: PrismaClient, n: number) {
  const id = String(n).padStart(2, '0');
  return prisma.user.create({ data: { accountType: 'APPLICANT', fullName: `Sample Applicant ${id} (fictional)`, email: `applicant${id}@avn.local`, phone: `+23480100000${id}`, phoneVerifiedAt: new Date(), passwordHash: await demoHash(), applicantProfile: { create: {} } } });
}

/** Generates a unique synthetic JPEG labelled as fictional sample evidence. */
export async function sampleEvidenceJpeg(label: string, seed: number): Promise<Buffer> {
  let x = seed * 9301 + 49297;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const shapes = Array.from({ length: 14 }, () => `<rect x="${Math.round(rnd() * 1100)}" y="${Math.round(rnd() * 700)}" width="${80 + Math.round(rnd() * 260)}" height="${60 + Math.round(rnd() * 200)}" fill="hsl(${Math.round(rnd() * 360)},45%,${30 + Math.round(rnd() * 40)}%)"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="960"><rect width="1280" height="960" fill="hsl(${seed * 37 % 360},25%,70%)"/>${shapes}
  <rect x="40" y="800" width="1200" height="120" fill="rgba(0,0,0,.55)"/><text x="60" y="875" font-family="sans-serif" font-size="48" fill="#fff">SAMPLE EVIDENCE — FICTIONAL — ${label}</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

/** Supertest client bound to one application audience, keeping that app's session cookie. */
export function client(app: Express, audience: AppAudience) {
  const agent = request.agent(app);
  const h = (r: request.Test) => r.set('X-AVN-App', audience);
  return {
    agent,
    get: (url: string) => h(agent.get(`/api/v1${url}`)),
    post: (url: string, body?: object) => h(agent.post(`/api/v1${url}`)).send(body ?? {}),
    put: (url: string, body?: object) => h(agent.put(`/api/v1${url}`)).send(body ?? {}),
    patch: (url: string, body?: object) => h(agent.patch(`/api/v1${url}`)).send(body ?? {}),
    delete: (url: string) => h(agent.delete(`/api/v1${url}`)),
    upload: (url: string, field: string, file: Buffer, name: string, fields: Record<string, string | number | boolean> = {}) => {
      let r = h(agent.post(`/api/v1${url}`)).attach(field, file, name);
      for (const [k, v] of Object.entries(fields)) r = r.field(k, String(v));
      return r;
    },
    login: (email: string, password = DEMO_PASSWORD) => h(agent.post('/api/v1/auth/login')).send({ email, password }),
  };
}
export type Client = ReturnType<typeof client>;

export const presentChecklist = {
  applicantAvailable: 'YES',
  applicantConfirmedResidence: 'YES',
  occupantConfirmedResidence: 'UNKNOWN',
  anyoneAvailable: 'YES',
  contactRefused: 'NO',
  propertyAccessible: 'YES',
  addressMatchesDescription: 'YES',
  buildingExists: 'YES',
  buildingType: 'BLOCK_OF_FLATS',
  occupancySigns: 'OCCUPIED',
  houseNumberVisible: true,
  observations: 'Seed scenario (fictional).',
} as const;

export const absentChecklist = { ...presentChecklist, applicantAvailable: 'NO', applicantConfirmedResidence: 'UNKNOWN', occupantConfirmedResidence: 'NO', anyoneAvailable: 'NO' } as const;

export const sampleAddress = (p: { lat: number; lng: number }, street: string, city = 'Ikeja', lga = 'Ikeja') => ({
  countryCode: 'NG',
  state: 'Lagos',
  lga,
  city,
  district: city,
  street,
  houseNumber: String(10 + Math.round(Math.abs(p.lat * 1000) % 80)),
  landmark: 'Near the (fictional) green gate',
  lat: p.lat,
  lng: p.lng,
  locationSource: 'MAP_PIN',
});

export const consent = { privacyNoticeAccepted: true, visitAuthorised: true, dataSharingAuthorised: true };
