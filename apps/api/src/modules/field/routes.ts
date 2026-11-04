import { z } from 'zod';
import { hashOtp } from '@avn/auth';
import { arrivalSchema, confirmationCodeSchema, draftSchema, evidenceMetaSchema, incidentSchema, policyRulesSchema, visitSubmitSchema, type PolicyRules } from '@avn/contracts';
import { Prisma } from '@avn/database';
import { haversineMetres } from '@avn/shared-utils/geo';
import { numericCode, safeEqual } from '@avn/shared-utils/crypto';
import { IMAGE_MIME, VIDEO_MIME } from '@avn/storage';
import { deps } from '../../container';
import { actorFrom, audit } from '../../lib/audit';
import { requireVerifier } from '../../lib/auth';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { signedFileUrl, storeFile, upload } from '../../lib/files';
import { routes, uuidParam } from '../../lib/http';
import { enqueue } from '../../lib/jobs';
import { notifyUser, sendDirect } from '../../lib/notify';
import { consume } from '../../lib/rate-limit';
import { getPlatformConfig } from '../../lib/settings';
import { withTx } from '../../lib/tx';
import { releaseAssignment } from '../assignments/service';
import { arrivalSignals, evidenceSignals, hamming, submissionSignals } from '../fraud/rules';
import { addressLines } from '../requests/service';
import { transition } from '../requests/transitions';
import { processVerification } from '../verification/process';
import { arrivalSignalsToRows, recordSignals } from '../fraud/service';
import { validateArrival } from './arrival';
import { deterministicFeedback, imageFacts } from './evidence';

export const assignmentRoutes = routes('/assignments', 'Field visits');
const ACTIVE = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];

async function ownAssignment(id: string, verifierId: string) {
  const a = await deps().prisma.verificationAssignment.findUnique({
    where: { id },
    include: { request: { include: { address: true, organisation: { select: { legalName: true, tradingName: true } } } }, fieldVisit: true },
  });
  if (!a || a.verifierId !== verifierId) throw notFound('Assignment');
  return a;
}
const rulesOf = (snapshot: unknown): PolicyRules => policyRulesSchema.parse((snapshot as { rules?: unknown })?.rules ?? {});

assignmentRoutes.get('/', { summary: 'My assignments (active and history)', guard: requireVerifier() }, async (ctx) => {
  const list = await deps().prisma.verificationAssignment.findMany({
    where: { verifierId: ctx.auth.verifier!.id },
    orderBy: { acceptedAt: 'desc' },
    take: 50,
    include: { request: { select: { reference: true, status: true, level: true, address: { select: { district: true, city: true } } } } },
  });
  return list.map((a) => ({ id: a.id, status: a.status, reference: a.request.reference, requestStatus: a.request.status, level: a.request.level, area: [a.request.address?.district, a.request.address?.city].filter(Boolean).join(', '), reward: a.reward.toFixed(2), acceptedAt: a.acceptedAt, submittedAt: a.submittedAt, deadline: a.deadline }));
});

assignmentRoutes.get('/:id', { summary: 'Assignment details (full address only after acceptance)', guard: requireVerifier() }, async (ctx) => {
  const a = await ownAssignment(uuidParam(ctx), ctx.auth.verifier!.id);
  const r = a.request;
  const evidence = a.fieldVisit
    ? await deps().prisma.verificationEvidence.findMany({ where: { visitId: a.fieldVisit.id }, orderBy: { createdAt: 'asc' } })
    : [];
  const analyses = evidence.length
    ? await deps().prisma.aiAnalysis.findMany({ where: { subjectType: 'VerificationEvidence', subjectId: { in: evidence.map((e) => e.id) } }, orderBy: { createdAt: 'desc' } })
    : [];
  const rules = rulesOf(r.policySnapshot);
  const cfg = await getPlatformConfig();
  const live = ACTIVE.includes(a.status);
  return {
    id: a.id,
    status: a.status,
    reference: r.reference,
    requestStatus: r.status,
    level: r.level,
    reward: a.reward.toFixed(2),
    currency: r.currency,
    deadline: a.deadline,
    organisation: r.organisation ? (r.organisation.tradingName ?? r.organisation.legalName) : null,
    // Exact location and applicant contact only while the verifier holds the job.
    target: live && r.address ? { lat: r.address.lat, lng: r.address.lng } : null,
    address: live ? addressLines(r.address) : [],
    landmark: live ? r.address?.landmark : null,
    directions: live ? r.address?.directions : null,
    applicant: live ? { firstName: r.applicantName.split(' ')[0], phone: r.applicantPhone } : null,
    visitWindow: r.visitWindow,
    instructions: r.instructions,
    requiredEvidence: rules.requiredEvidence,
    mandatoryVideo: rules.mandatoryVideo,
    arrivalThresholdM: cfg.arrivalThresholdM,
    visit: a.fieldVisit
      ? {
          arrivedAt: a.fieldVisit.arrivalAt,
          distanceFromTargetM: a.fieldVisit.distanceFromTargetM,
          withinThreshold: a.fieldVisit.withinThreshold,
          arrivalException: a.fieldVisit.arrivalException,
          applicantConfirmedAt: a.fieldVisit.applicantConfirmedAt,
          confirmationMethod: a.fieldVisit.confirmationMethod,
          codeSentAt: a.fieldVisit.confirmationExpiresAt ? new Date(a.fieldVisit.confirmationExpiresAt.getTime() - 15 * 60_000) : null,
          draft: a.fieldVisit.draft,
          draftUpdatedAt: a.fieldVisit.draftUpdatedAt,
          submittedAt: a.fieldVisit.submittedAt,
          incidents: a.fieldVisit.incidents,
        }
      : null,
    evidence: evidence.map((e) => {
      const ai = analyses.find((x) => x.subjectId === e.id && x.status === 'SUCCEEDED');
      return {
        id: e.id,
        category: e.category,
        capturedAt: e.capturedAt,
        receivedAt: e.receivedAt,
        distanceFromTargetM: e.distanceFromTargetM,
        accuracyM: e.accuracyM,
        url: signedFileUrl(e.fileId),
        aiSuggestion: ai ? { label: 'AI suggestion (not a verification result)', nextAction: ai.nextAction, explanation: ai.explanation, confidence: ai.confidence, findings: ai.findings } : null,
      };
    }),
  };
});

assignmentRoutes.get(
  '/:id/route',
  { summary: 'Walking route from current position to the property', guard: requireVerifier(), query: z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }) },
  async (ctx) => {
    const a = await ownAssignment(uuidParam(ctx), ctx.auth.verifier!.id);
    if (!ACTIVE.includes(a.status) || !a.request.address) throw conflict('Assignment is not active');
    const to = { lat: a.request.address.lat, lng: a.request.address.lng };
    const route = await deps().router.walkingRoute({ lat: ctx.query.lat, lng: ctx.query.lng }, to, { withShape: true });
    return {
      ...route,
      straightLineM: Math.round(haversineMetres({ lat: ctx.query.lat, lng: ctx.query.lng }, to)),
      externalNavigation: {
        google: `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}&travelmode=walking`,
        osm: `https://www.openstreetmap.org/directions?engine=fossgis_valhalla_foot&route=${ctx.query.lat},${ctx.query.lng};${to.lat},${to.lng}`,
        geo: `geo:${to.lat},${to.lng}?q=${to.lat},${to.lng}`,
      },
    };
  },
);

assignmentRoutes.post('/:id/en-route', { summary: 'Mark as travelling to the property', guard: requireVerifier({ approved: true }) }, async (ctx) => {
  const a = await ownAssignment(uuidParam(ctx), ctx.auth.verifier!.id);
  if (a.status !== 'ACCEPTED') return { status: a.status };
  await withTx(async (tx, after) => {
    await tx.verificationAssignment.update({ where: { id: a.id }, data: { status: 'EN_ROUTE', enRouteAt: new Date() } });
    await transition(tx, after, a.requestId, 'EN_ROUTE', { type: 'VERIFIER', id: a.verifierId });
  });
  return { status: 'EN_ROUTE' };
});

assignmentRoutes.post('/:id/arrive', { summary: 'Record arrival with GPS fix (validates threshold, records integrity signals)', guard: requireVerifier({ approved: true }), body: arrivalSchema }, async (ctx) => {
  const a = await ownAssignment(uuidParam(ctx), ctx.auth.verifier!.id);
  if (!['ACCEPTED', 'EN_ROUTE'].includes(a.status)) throw conflict('Arrival already recorded or assignment not active');
  if (!a.request.address || !a.fieldVisit) throw conflict('Assignment has no target');
  const cfg = await getPlatformConfig();
  const target = { lat: a.request.address.lat, lng: a.request.address.lng };
  const point = { lat: ctx.body.lat, lng: ctx.body.lng };
  const result = validateArrival(target, point, ctx.body.accuracyM, cfg.arrivalThresholdM, cfg.maxGpsAccuracyM);
  const avail = await deps().prisma.verifierAvailability.findUnique({ where: { verifierId: a.verifierId } });
  const now = new Date();
  const signals = arrivalSignals({
    isMocked: ctx.body.isMocked,
    accuracyM: ctx.body.accuracyM,
    maxAccuracyM: cfg.maxGpsAccuracyM,
    arrivalPoint: point,
    arrivalAt: now,
    lastKnown: avail?.lastLat != null && avail.lastLng != null && avail.lastHeartbeatAt ? { point: { lat: avail.lastLat, lng: avail.lastLng }, at: avail.lastHeartbeatAt } : null,
  });
  // Outside threshold without a declared exception is recorded, not rejected; the engine routes it to review.
  const exception = ctx.body.exception !== 'NONE' ? ctx.body.exception : !result.accuracyAcceptable ? 'POOR_GPS' : 'NONE';
  await withTx(async (tx, after) => {
    await tx.fieldVisit.update({
      where: { id: a.fieldVisit!.id },
      data: {
        arrivalLat: point.lat,
        arrivalLng: point.lng,
        arrivalAccuracyM: ctx.body.accuracyM,
        arrivalAt: now,
        arrivalClientAt: ctx.body.capturedAt,
        distanceFromTargetM: result.distanceM,
        thresholdM: result.thresholdM,
        withinThreshold: result.withinThreshold,
        arrivalException: exception,
        exceptionNote: ctx.body.exceptionNote,
        integritySignals: { accuracyAcceptable: result.accuracyAcceptable, withinConsideringAccuracy: result.withinThresholdConsideringAccuracy, signals: signals.map((s) => s.rule), mocked: !!ctx.body.isMocked } as object,
      },
    });
    await tx.verificationAssignment.update({ where: { id: a.id }, data: { status: 'IN_PROGRESS', arrivedAt: now, startedAt: now } });
    if (a.status === 'ACCEPTED') await transition(tx, after, a.requestId, 'EN_ROUTE', { type: 'VERIFIER', id: a.verifierId });
    await transition(tx, after, a.requestId, 'ARRIVED', { type: 'VERIFIER', id: a.verifierId }, { note: `${result.distanceM} m from pin (±${Math.round(ctx.body.accuracyM)} m)` });
    await transition(tx, after, a.requestId, 'VISIT_IN_PROGRESS', { type: 'VERIFIER', id: a.verifierId });
    await recordSignals(tx, arrivalSignalsToRows(signals, a.requestId, a.verifierId));
    await audit(actorFrom(ctx), 'visit.arrived', 'FieldVisit', a.fieldVisit!.id, { distanceM: result.distanceM, accuracyM: ctx.body.accuracyM, exception }, { organisationId: a.request.organisationId, db: tx });
  });
  return { ...result, exception, signals: signals.map((s) => ({ rule: s.rule, severity: s.severity, explanation: s.explanation })) };
});

assignmentRoutes.post(
  '/:id/evidence',
  { summary: 'Upload camera-captured evidence (idempotent per file hash; resumable)', guard: requireVerifier({ approved: true }), upload: upload('file'), body: evidenceMetaSchema },
  async (ctx) => {
    const { prisma } = deps();
    const a = await ownAssignment(uuidParam(ctx), ctx.auth.verifier!.id);
    if (a.status !== 'IN_PROGRESS' || !a.fieldVisit) throw conflict('Record your arrival before capturing evidence');
    if (!ctx.file) throw badRequest('Attach the captured photo or video');
    await consume('evidence', a.verifierId, 60, 600);
    const isVideo = ctx.body.category === 'VIDEO_WALKTHROUGH';
    const file = await storeFile({ data: ctx.file.buffer, allowed: isVideo ? VIDEO_MIME : IMAGE_MIME, purpose: 'evidence', ownerUserId: ctx.auth.user!.id, organisationId: a.request.organisationId });

    const dupSameVisit = await prisma.verificationEvidence.findFirst({ where: { visitId: a.fieldVisit.id, serverSha256: file.sha256 } });
    if (dupSameVisit) return { id: dupSameVisit.id, duplicateRetry: true }; // resumable retry of an upload that already landed

    const facts = isVideo ? null : await imageFacts(ctx.file.buffer).catch(() => null);
    const cfg = await getPlatformConfig();
    const target = { lat: a.request.address!.lat, lng: a.request.address!.lng };
    const exactElsewhere = await prisma.verificationEvidence.findFirst({ where: { serverSha256: file.sha256, requestId: { not: a.requestId } }, select: { id: true } });
    let similar: { distance: number; evidenceId: string } | null = null;
    if (facts) {
      const others = await prisma.verificationEvidence.findMany({ where: { perceptualHash: { not: null }, requestId: { not: a.requestId } }, select: { id: true, perceptualHash: true }, orderBy: { createdAt: 'desc' }, take: 2000 });
      for (const o of others) {
        const d = hamming(facts.dHash, o.perceptualHash!);
        if (d <= 4 && (!similar || d < similar.distance)) similar = { distance: d, evidenceId: o.id };
      }
    }
    const receivedAt = new Date();
    const signals = evidenceSignals({
      serverSha256: file.sha256,
      clientSha256: ctx.body.clientSha256,
      compressed: !!ctx.body.compressed,
      exactDuplicateElsewhere: !!exactElsewhere,
      similarElsewhere: similar,
      capturedAt: ctx.body.capturedAt,
      receivedAt,
      point: { lat: ctx.body.lat, lng: ctx.body.lng },
      accuracyM: ctx.body.accuracyM,
      target,
      thresholdM: cfg.arrivalThresholdM,
      maxAccuracyM: cfg.maxGpsAccuracyM,
    });
    const ev = await withTx(async (tx) => {
      const created = await tx.verificationEvidence.create({
        data: {
          requestId: a.requestId,
          visitId: a.fieldVisit!.id,
          verifierId: a.verifierId,
          category: ctx.body.category,
          fileId: file.id,
          serverSha256: file.sha256,
          originalSha256: ctx.body.originalSha256 ?? ctx.body.clientSha256,
          perceptualHash: facts?.dHash,
          width: facts?.width,
          height: facts?.height,
          compressed: !!ctx.body.compressed,
          lat: ctx.body.lat,
          lng: ctx.body.lng,
          accuracyM: ctx.body.accuracyM,
          capturedAt: ctx.body.capturedAt,
          receivedAt,
          deviceId: ctx.body.deviceId,
          captureSource: ctx.body.captureSource,
          distanceFromTargetM: Math.round(haversineMetres({ lat: ctx.body.lat, lng: ctx.body.lng }, target)),
          duplicateOfId: exactElsewhere?.id ?? null,
        },
      });
      await recordSignals(
        tx,
        signals.map((s) => ({ requestId: a.requestId, verifierId: a.verifierId, evidenceId: created.id, rule: s.rule, severity: s.severity, score: s.score, explanation: s.explanation, data: (s.data ?? undefined) as object | undefined })),
      );
      return created;
    });
    await audit(actorFrom(ctx), 'evidence.captured', 'VerificationEvidence', ev.id, { category: ev.category, sha256: file.sha256 }, { organisationId: a.request.organisationId });
    await enqueue('ai.evidence', { evidenceId: ev.id });
    const feedback = facts ? deterministicFeedback(facts) : { clarity: 'ACCEPTABLE' as const, messages: [] };
    return { id: ev.id, serverSha256: file.sha256, feedback, integrity: signals.map((s) => ({ rule: s.rule, severity: s.severity, explanation: s.explanation })) };
  },
);

assignmentRoutes.post('/:id/confirmation-code', { summary: 'Send a one-time visit confirmation code to the applicant', guard: requireVerifier({ approved: true }) }, async (ctx) => {
  const { prisma, env } = deps();
  const a = await ownAssignment(uuidParam(ctx), ctx.auth.verifier!.id);
  if (a.status !== 'IN_PROGRESS' || !a.fieldVisit) throw conflict('Record your arrival first');
  await consume('visit-code', a.id, 3, 3600);
  const code = numericCode(6);
  await prisma.fieldVisit.update({
    where: { id: a.fieldVisit.id },
    data: { confirmationCodeHash: hashOtp(env.SESSION_SECRET, a.fieldVisit.id, code), confirmationExpiresAt: new Date(Date.now() + 15 * 60_000), confirmationAttempts: 0 },
  });
  if (a.request.applicantUserId) await notifyUser(a.request.applicantUserId, 'visit.confirmation_code', { code }, { channels: [], data: { requestId: a.requestId } });
  await sendDirect('SMS', a.request.applicantPhone, 'visit.confirmation_code', { code });
  await audit(actorFrom(ctx), 'visit.code_sent', 'FieldVisit', a.fieldVisit.id);
  return { sent: true, expiresInSeconds: 900 };
});

assignmentRoutes.post('/:id/confirmation-code/verify', { summary: 'Verify the code the applicant shared', guard: requireVerifier({ approved: true }), body: confirmationCodeSchema }, async (ctx) => {
  const { prisma, env } = deps();
  const a = await ownAssignment(uuidParam(ctx), ctx.auth.verifier!.id);
  const v = a.fieldVisit;
  if (!v?.confirmationCodeHash || !v.confirmationExpiresAt || v.confirmationExpiresAt < new Date()) throw new AppError(400, 'CODE_EXPIRED', 'No active code — send a new one');
  if (v.confirmationAttempts >= 5) throw new AppError(429, 'RATE_LIMITED', 'Too many attempts');
  if (!safeEqual(hashOtp(env.SESSION_SECRET, v.id, ctx.body.code), v.confirmationCodeHash)) {
    await prisma.fieldVisit.update({ where: { id: v.id }, data: { confirmationAttempts: { increment: 1 } } });
    throw new AppError(400, 'CODE_INVALID', 'Incorrect code');
  }
  await prisma.fieldVisit.update({ where: { id: v.id }, data: { applicantConfirmedAt: new Date(), confirmationMethod: 'CODE_TO_VERIFIER', confirmationCodeHash: null } });
  await audit(actorFrom(ctx), 'visit.applicant_confirmed', 'FieldVisit', v.id, { method: 'CODE_TO_VERIFIER' });
  return { confirmed: true };
});

assignmentRoutes.put('/:id/draft', { summary: 'Save checklist draft (resume after connectivity loss)', guard: requireVerifier(), body: draftSchema }, async (ctx) => {
  const a = await ownAssignment(uuidParam(ctx), ctx.auth.verifier!.id);
  if (!a.fieldVisit || a.fieldVisit.submittedAt) throw conflict('Visit already submitted');
  // Last-writer-wins by client timestamp so a stale offline draft never overwrites a newer one.
  if (a.fieldVisit.draftUpdatedAt && a.fieldVisit.draftUpdatedAt > ctx.body.clientUpdatedAt) return { saved: false, serverUpdatedAt: a.fieldVisit.draftUpdatedAt };
  await deps().prisma.fieldVisit.update({ where: { id: a.fieldVisit.id }, data: { draft: ctx.body.checklist as object, draftUpdatedAt: ctx.body.clientUpdatedAt } });
  return { saved: true, serverUpdatedAt: ctx.body.clientUpdatedAt };
});

assignmentRoutes.post('/:id/incidents', { summary: 'Request assistance or report unsafe conditions', guard: requireVerifier(), body: incidentSchema }, async (ctx) => {
  const { prisma } = deps();
  const a = await ownAssignment(uuidParam(ctx), ctx.auth.verifier!.id);
  if (!a.fieldVisit) throw conflict('No active visit');
  const incidents = [...((a.fieldVisit.incidents as unknown[]) ?? []), { ...ctx.body, at: new Date().toISOString() }];
  await prisma.fieldVisit.update({ where: { id: a.fieldVisit.id }, data: { incidents: incidents as object } });
  await audit(actorFrom(ctx), `visit.incident.${ctx.body.kind.toLowerCase()}`, 'FieldVisit', a.fieldVisit.id, { message: ctx.body.message });
  const admins = await prisma.user.findMany({ where: { accountType: 'ADMIN', adminRole: { in: ['SUPER_ADMIN', 'OPERATIONS'] }, status: 'ACTIVE' }, select: { id: true } });
  for (const ad of admins) await notifyUser(ad.id, 'review.required', { reference: `${a.request.reference} — ${ctx.body.kind === 'UNSAFE_CONDITIONS' ? 'UNSAFE CONDITIONS' : 'assistance requested'}` }, { channels: ['PUSH'] });
  return { recorded: true };
});

assignmentRoutes.post('/:id/release', { summary: 'Give the job back (it will be reassigned)', guard: requireVerifier(), body: z.object({ reason: z.string().trim().min(3).max(300) }) }, async (ctx) => {
  const a = await ownAssignment(uuidParam(ctx), ctx.auth.verifier!.id);
  if (a.status === 'IN_PROGRESS') throw conflict('You have already arrived — submit what you observed instead');
  await releaseAssignment(a.id, ctx.body.reason, actorFrom(ctx), 'VERIFIER');
  return { released: true };
});

assignmentRoutes.post('/:id/submit', { summary: 'Submit the structured checklist and evidence (idempotent)', guard: requireVerifier({ approved: true }), body: visitSubmitSchema }, async (ctx) => {
  const { prisma } = deps();
  const a = await ownAssignment(uuidParam(ctx), ctx.auth.verifier!.id);
  const v = a.fieldVisit;
  if (!v) throw conflict('No active visit');
  if (v.submittedAt) {
    if (v.submissionKey === ctx.body.idempotencyKey) return { submitted: true, replay: true, requestStatus: a.request.status };
    throw conflict('This visit has already been submitted');
  }
  if (a.status !== 'IN_PROGRESS') throw conflict('Record your arrival before submitting');
  const rules = rulesOf(a.request.policySnapshot);
  const evidence = await prisma.verificationEvidence.findMany({ where: { visitId: v.id }, select: { category: true } });
  const present = new Set(evidence.map((e) => e.category));
  const missing = rules.requiredEvidence.filter((c) => !present.has(c));
  const inaccessible = v.arrivalException === 'PROPERTY_INACCESSIBLE' || ctx.body.checklist.propertyAccessible === 'NO';
  if (missing.length && !inaccessible) throw new AppError(422, 'EVIDENCE_REQUIRED', `Capture the required evidence first: ${missing.join(', ')}`, { missing });
  const now = new Date();
  await withTx(async (tx, after) => {
    await tx.fieldVisit.update({ where: { id: v.id }, data: { checklist: ctx.body.checklist as object, submittedAt: now, submissionKey: ctx.body.idempotencyKey, draft: Prisma.DbNull } });
    await tx.verificationAssignment.update({ where: { id: a.id }, data: { status: 'SUBMITTED', submittedAt: now } });
    await transition(tx, after, a.requestId, 'EVIDENCE_SUBMITTED', { type: 'VERIFIER', id: a.verifierId }, { note: `${evidence.length} evidence item(s)` });
    await transition(tx, after, a.requestId, 'PROCESSING', { type: 'SYSTEM' });
    await recordSignals(
      tx,
      submissionSignals({ arrivedAt: a.arrivedAt, submittedAt: now }).map((s) => ({ requestId: a.requestId, verifierId: a.verifierId, rule: s.rule, severity: s.severity, score: s.score, explanation: s.explanation })),
    );
    await audit(actorFrom(ctx), 'visit.submitted', 'FieldVisit', v.id, { evidence: evidence.length }, { organisationId: a.request.organisationId, db: tx });
    after(async () => {
      await processVerification(a.requestId);
    });
  });
  const updated = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: a.requestId }, select: { status: true } });
  return { submitted: true, requestStatus: updated.status };
});
