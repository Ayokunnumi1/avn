import { STATUS_LABELS } from '@avn/contracts';
import { deps } from '../../container';
import { signedFileUrl } from '../../lib/files';
import { notFound } from '../../lib/errors';
import { FINDING_LABELS, OUTCOME_LABELS, VALUE_LABELS } from '../verification/engine';
import { addressLines } from './service';

/**
 * Full request view for institution staff and administrators. Evidence and documents are
 * exposed only as short-lived signed links, and only when the caller is allowed to see them.
 */
export async function requestDetail(requestId: string, opts: { organisationId?: string; includeEvidence: boolean; admin?: boolean }) {
  const { prisma } = deps();
  const r = await prisma.verificationRequest.findUnique({
    where: { id: requestId },
    include: {
      address: true,
      organisation: { select: { id: true, legalName: true } },
      statusEvents: { orderBy: { createdAt: 'asc' } },
      findings: { where: { supersededAt: null } },
      reports: { orderBy: { version: 'desc' } },
      disputes: { orderBy: { createdAt: 'desc' } },
      manualReviews: { orderBy: { createdAt: 'desc' } },
      fraudSignals: { orderBy: { createdAt: 'desc' } },
      documents: true,
      invitation: true,
      assignments: { orderBy: { acceptedAt: 'desc' }, include: { verifier: { include: { user: { select: { fullName: true, phone: true } } } } } },
      offers: { orderBy: { createdAt: 'desc' }, take: 20 },
      fieldVisits: { orderBy: { createdAt: 'desc' }, include: { evidence: { orderBy: { capturedAt: 'asc' } } } },
      policyVersion: { include: { policy: { select: { name: true } } } },
    },
  });
  // Tenant isolation: an institution can never load another institution's record.
  if (!r || (opts.organisationId && r.organisationId !== opts.organisationId)) throw notFound('Verification request');
  const visit = r.fieldVisits[0];
  const ai = opts.includeEvidence && visit ? await prisma.aiAnalysis.findMany({ where: { requestId: r.id, status: 'SUCCEEDED' }, orderBy: { createdAt: 'desc' } }) : [];
  return {
    id: r.id,
    reference: r.reference,
    status: r.status,
    statusLabel: STATUS_LABELS[r.status],
    outcome: r.outcome,
    outcomeLabel: r.outcome ? OUTCOME_LABELS[r.outcome] : null,
    source: r.source,
    level: r.level,
    purpose: r.purpose,
    priority: r.priority,
    customerReference: r.customerReference,
    department: r.department,
    applicant: { name: r.applicantName, phone: r.applicantPhone, email: r.applicantEmail },
    address: r.address ? { lines: addressLines(r.address), lat: r.address.lat, lng: r.address.lng, state: r.address.state, city: r.address.city, landmark: r.address.landmark, source: r.address.locationSource, gpsAccuracyM: r.address.gpsAccuracyM } : null,
    policy: { name: (r.policySnapshot as { name?: string }).name ?? r.policyVersion?.policy.name ?? null, version: r.policyVersion?.version ?? null, rules: (r.policySnapshot as { rules?: unknown }).rules },
    price: r.price.toFixed(2),
    currency: r.currency,
    deadline: r.deadline,
    instructions: r.instructions,
    riskScore: r.riskScore,
    riskFlagged: r.riskFlagged,
    coverageFallback: r.coverageFallback,
    createdAt: r.createdAt,
    submittedAt: r.submittedAt,
    outcomeAt: r.outcomeAt,
    invitation: r.invitation ? { status: r.invitation.status, expiresAt: r.invitation.expiresAt, sendCount: r.invitation.sendCount, openedAt: r.invitation.openedAt } : null,
    timeline: r.statusEvents.map((e) => ({ from: e.fromStatus, to: e.toStatus, label: STATUS_LABELS[e.toStatus], actorType: e.actorType, note: e.note, at: e.createdAt })),
    findings: r.findings.map((f) => ({ key: f.key, label: FINDING_LABELS[f.key], value: f.value, valueLabel: VALUE_LABELS[f.value], basis: f.basis, source: f.source, rulesVersion: f.rulesVersion })),
    reports: r.reports.map((rep) => ({ id: rep.id, reference: rep.reference, version: rep.version, outcome: rep.outcome, issuedAt: rep.issuedAt, validUntil: rep.validUntil, revokedAt: rep.revokedAt, aiAssisted: rep.aiAssisted, contentHash: rep.contentHash, summary: rep.summary })),
    disputes: r.disputes.map((d) => ({ id: d.id, raisedByType: d.raisedByType, reason: d.reason, details: d.details, status: d.status, resolutionNote: d.resolutionNote, createdAt: d.createdAt, resolvedAt: d.resolvedAt })),
    manualReviews: r.manualReviews.map((m) => ({ id: m.id, status: m.status, trigger: m.trigger, reasons: m.reasons, outcome: m.outcome, createdAt: m.createdAt, resolvedAt: m.resolvedAt, ...(opts.admin ? { notes: m.notes } : {}) })),
    riskSignals: r.fraudSignals.map((s) => ({ id: s.id, rule: s.rule, severity: s.severity, score: s.score, explanation: s.explanation, status: s.status, createdAt: s.createdAt })),
    assignment: r.assignments[0]
      ? {
          id: r.assignments[0].id,
          status: r.assignments[0].status,
          verifierCode: `VRF-${r.assignments[0].verifierId.slice(0, 8).toUpperCase()}`,
          ...(opts.admin ? { verifierId: r.assignments[0].verifierId, verifierName: r.assignments[0].verifier.user.fullName, verifierPhone: r.assignments[0].verifier.user.phone } : {}),
          acceptedAt: r.assignments[0].acceptedAt,
          arrivedAt: r.assignments[0].arrivedAt,
          submittedAt: r.assignments[0].submittedAt,
          walkingMinutes: r.assignments[0].walkingMinutes?.toString() ?? null,
          routingSource: r.assignments[0].routingSource,
        }
      : null,
    assignmentHistory: opts.admin ? r.assignments.map((a) => ({ id: a.id, status: a.status, verifierId: a.verifierId, verifierName: a.verifier.user.fullName, acceptedAt: a.acceptedAt, releasedAt: a.releasedAt, releaseReason: a.releaseReason })) : undefined,
    offers: opts.admin ? r.offers.map((o) => ({ id: o.id, verifierId: o.verifierId, tier: o.tier, status: o.status, walkingMinutes: o.walkingMinutes.toString(), routingSource: o.routingSource, expiresAt: o.expiresAt, declineReason: o.declineReason })) : undefined,
    visit: visit
      ? {
          arrivedAt: visit.arrivalAt,
          arrival: visit.arrivalLat != null ? { lat: visit.arrivalLat, lng: visit.arrivalLng, accuracyM: visit.arrivalAccuracyM, distanceFromTargetM: visit.distanceFromTargetM, thresholdM: visit.thresholdM, withinThreshold: visit.withinThreshold, exception: visit.arrivalException, exceptionNote: visit.exceptionNote } : null,
          integritySignals: visit.integritySignals,
          checklist: visit.checklist,
          applicantConfirmedAt: visit.applicantConfirmedAt,
          confirmationMethod: visit.confirmationMethod,
          submittedAt: visit.submittedAt,
          incidents: opts.admin ? visit.incidents : undefined,
          evidence: opts.includeEvidence
            ? visit.evidence.map((e) => ({
                id: e.id,
                category: e.category,
                url: signedFileUrl(e.fileId),
                capturedAt: e.capturedAt,
                receivedAt: e.receivedAt,
                lat: e.lat,
                lng: e.lng,
                accuracyM: e.accuracyM,
                distanceFromTargetM: e.distanceFromTargetM,
                sha256: e.serverSha256,
                compressed: e.compressed,
                duplicateOf: e.duplicateOfId,
                deviceRef: opts.admin ? e.deviceId : undefined,
                aiSuggestion: (() => {
                  const a = ai.find((x) => x.subjectId === e.id);
                  return a ? { label: 'AI suggestion — not a verification finding', nextAction: a.nextAction, explanation: a.explanation, confidence: a.confidence, model: a.model, promptVersion: a.promptVersion } : null;
                })(),
              }))
            : [],
          evidenceCount: visit.evidence.length,
        }
      : null,
    documents: opts.includeEvidence ? r.documents.map((d) => ({ id: d.id, documentType: d.documentType, url: signedFileUrl(d.fileId), createdAt: d.createdAt })) : r.documents.length,
  };
}
