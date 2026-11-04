import type { Express } from 'express';
import type { PrismaClient } from '@avn/database';
import { absentChecklist, client, consent, presentChecklist, sampleAddress, sampleEvidenceJpeg, type Client } from './fixtures';

/**
 * End-to-end scenario driver: institution creates a request → applicant opens the secure
 * link and submits → a nearby verifier goes available, accepts, arrives, captures evidence
 * and submits → engine decides → report is issued. Used by the seed and by E2E tests.
 */
export interface ScenarioOptions {
  app: Express;
  prisma: PrismaClient;
  business: Client;
  verifierEmail: string;
  target: { lat: number; lng: number };
  street: string;
  customerReference: string;
  applicantName: string;
  applicantPhone: string;
  absent?: boolean;
  arrivalOffsetLat?: number;
  seed: number;
  stopAfter?: 'created' | 'submitted' | 'accepted' | 'arrived';
}

const fail = (step: string, res: { status: number; body: unknown }) => {
  throw new Error(`${step} failed: HTTP ${res.status} ${JSON.stringify(res.body)}`);
};

export async function runScenario(o: ScenarioOptions) {
  const created = await o.business.post('/org/requests', {
    applicantName: o.applicantName,
    applicantPhone: o.applicantPhone,
    customerReference: o.customerReference,
    level: 'STANDARD',
    purpose: 'BANK_ACCOUNT',
    sendInvitation: true,
  });
  if (created.status !== 201) fail('create request', created);
  const requestId: string = created.body.id;
  const token = String(created.body.invitationUrl).split('/invite/')[1]!;
  if (o.stopAfter === 'created') return { requestId, invitationUrl: created.body.invitationUrl as string };

  // Simulation isolation: no verifier is on duty when the applicant submits.
  await o.prisma.verifierAvailability.updateMany({ data: { isAvailable: false, sessionId: null } });
  const applicant = client(o.app, 'applicant');
  const otp = await applicant.post(`/invitations/${token}/otp`);
  if (otp.status !== 200 || !otp.body.devCode) fail('invitation otp', otp);
  const v = await applicant.post(`/invitations/${token}/verify`, { code: otp.body.devCode });
  if (v.status !== 200) fail('invitation verify', v);
  const submitted = await applicant.post(`/me/requests/${requestId}/submit`, {
    fullName: o.applicantName,
    address: sampleAddress(o.target, o.street),
    consent,
    visitWindow: { date: new Date(Date.now() + 86400_000).toISOString().slice(0, 10), period: 'ANY' },
  });
  if (submitted.status !== 200) fail('applicant submit', submitted);
  if (o.stopAfter === 'submitted') return { requestId, applicant };

  // Simulation isolation: nobody else gets this request, and this verifier gets nobody else's.
  await o.prisma.assignmentInvitation.updateMany({ where: { status: 'SENT', requestId: { not: requestId } }, data: { status: 'WITHDRAWN' } });
  const verifier = client(o.app, 'verifier');
  const login = await verifier.login(o.verifierEmail);
  if (login.status !== 200) fail('verifier login', login);
  const near = { lat: o.target.lat + 0.004, lng: o.target.lng + 0.002 };
  const avail = await verifier.post('/verifiers/me/availability', { available: true, lat: near.lat, lng: near.lng, accuracyM: 8 });
  if (avail.status !== 200) fail('availability', avail);
  await o.prisma.verificationRequest.update({ where: { id: requestId }, data: { lastDispatchAt: null } });
  const { dispatchRequest } = await import('../modules/assignments/dispatch');
  await dispatchRequest(requestId);
  const offers = await verifier.get('/verifiers/me/offers');
  const own = await o.prisma.assignmentInvitation.findFirst({ where: { requestId, status: 'SENT', verifier: { user: { email: o.verifierEmail } } } });
  const offer = (offers.body as Array<{ id: string }>).find((x) => x.id === own?.id);
  if (!offer) fail('offer', offers);
  const acc = await verifier.post(`/offers/${offer!.id}/accept`, { idempotencyKey: `seed-accept-${requestId}` });
  if (acc.status !== 200) fail('accept', acc);
  const assignmentId: string = acc.body.assignmentId;
  if (o.stopAfter === 'accepted') return { requestId, applicant, verifier, assignmentId };

  await verifier.post(`/assignments/${assignmentId}/en-route`);
  // Simulate the walk: the last heartbeat was ten minutes before arrival.
  const vp = await o.prisma.verifierProfile.findFirstOrThrow({ where: { user: { email: o.verifierEmail, accountType: 'VERIFIER' } } });
  await o.prisma.verifierAvailability.update({ where: { verifierId: vp.id }, data: { lastHeartbeatAt: new Date(Date.now() - 10 * 60_000) } });
  await o.prisma.verificationAssignment.update({ where: { id: assignmentId }, data: { acceptedAt: new Date(Date.now() - 15 * 60_000) } });
  const arrivePoint = { lat: o.target.lat + (o.arrivalOffsetLat ?? 0.0001), lng: o.target.lng };
  const arr = await verifier.post(`/assignments/${assignmentId}/arrive`, { ...arrivePoint, accuracyM: 7, exception: 'NONE' });
  if (arr.status !== 200) fail('arrive', arr);
  if (o.stopAfter === 'arrived') return { requestId, applicant, verifier, assignmentId };

  for (const [i, category] of (['BUILDING_EXTERIOR', 'BUILDING_ENTRANCE', 'STREET_ENVIRONMENT'] as const).entries()) {
    const img = await sampleEvidenceJpeg(category.replace('_', ' '), o.seed * 10 + i);
    const up = await verifier.upload(`/assignments/${assignmentId}/evidence`, 'file', img, `${category}.jpg`, {
      category,
      lat: arrivePoint.lat,
      lng: arrivePoint.lng,
      accuracyM: 7,
      capturedAt: new Date().toISOString(),
      deviceId: `seed-device-${o.verifierEmail}`,
      captureSource: 'CAMERA',
    });
    if (up.status !== 200) fail(`evidence ${category}`, up);
  }
  if (!o.absent) {
    await verifier.post(`/assignments/${assignmentId}/confirmation-code`);
    const conf = await applicant.post(`/me/requests/${requestId}/visit/confirm`);
    if (conf.status !== 200) fail('applicant confirm', conf);
  }
  const sub = await verifier.post(`/assignments/${assignmentId}/submit`, { checklist: o.absent ? absentChecklist : presentChecklist, idempotencyKey: `seed-submit-${requestId}` });
  if (sub.status !== 200) fail('submit visit', sub);
  await verifier.post('/verifiers/me/availability', { available: false });
  const final = await o.prisma.verificationRequest.findUniqueOrThrow({ where: { id: requestId }, include: { reports: true } });
  return { requestId, applicant, verifier, assignmentId, status: final.status, outcome: final.outcome, reports: final.reports };
}
