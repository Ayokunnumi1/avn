import { REPORT_SUMMARY_PROMPT_VERSION, REPORT_SUMMARY_SYSTEM, summaryIntroducesNewNumbers } from '@avn/ai';
import type { FinalOutcome, FindingKey, FindingValue } from '@avn/contracts';
import { renderReportPdf } from '@avn/reporting';
import { hmacHex, reference, sha256Hex } from '@avn/shared-utils/crypto';
import { deps } from '../../container';
import { audit, SYSTEM } from '../../lib/audit';
import { storeFile } from '../../lib/files';
import { registerJob } from '../../lib/jobs';
import { notifyUser } from '../../lib/notify';
import { runAi } from '../ai/service';
import { emitWebhook } from '../integrations/webhooks';
import { addressLines } from '../requests/service';
import { FINDING_LABELS, OUTCOME_LABELS, VALUE_LABELS } from '../verification/engine';

/** Stable JSON (sorted keys) so the content hash is reproducible. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function templateSummary(outcome: FinalOutcome, findings: Array<{ key: FindingKey; value: FindingValue }>): string {
  const v = (k: FindingKey) => VALUE_LABELS[findings.find((f) => f.key === k)?.value ?? 'UNABLE_TO_DETERMINE'].toLowerCase();
  return (
    `Outcome: ${OUTCOME_LABELS[outcome]}. Building existence ${v('BUILDING_EXISTENCE')}; address match ${v('ADDRESS_MATCH')}; occupancy ${v('OCCUPANCY')}. ` +
    `Applicant presence ${v('APPLICANT_PRESENCE')}; residency confirmation ${v('RESIDENCY_CONFIRMATION')}; evidence integrity ${v('EVIDENCE_INTEGRITY')}.`
  );
}

/**
 * Builds a report ONLY from verified database records, optionally lets AI improve the
 * wording (rejected if it introduces facts), renders the PDF, hashes and signs it.
 */
export async function generateReport(requestId: string) {
  const { prisma, env, storage } = deps();
  const r = await prisma.verificationRequest.findUnique({
    where: { id: requestId },
    include: {
      address: true,
      organisation: true,
      findings: { where: { supersededAt: null } },
      reports: { orderBy: { version: 'desc' }, take: 1 },
      fieldVisits: { where: { submittedAt: { not: null } }, orderBy: { submittedAt: 'desc' }, take: 1, include: { evidence: true, verifier: { select: { id: true } } } },
    },
  });
  if (!r || !r.outcome || r.outcome === 'MANUAL_REVIEW') return null;
  const visit = r.fieldVisits[0];
  const policy = (r.policySnapshot as { rules?: { reportFreshnessDays?: number } }).rules;
  const issuedAt = new Date();
  const validUntil = new Date(issuedAt.getTime() + (policy?.reportFreshnessDays ?? 90) * 24 * 3600_000);
  const version = (r.reports[0]?.version ?? 0) + 1;
  const findings = r.findings.map((f) => ({ key: f.key, value: f.value, basis: f.basis as string[], source: f.source, rulesVersion: f.rulesVersion }));
  const snapshot = {
    request: { reference: r.reference, level: r.level, customerReference: r.customerReference, organisation: r.organisation?.legalName ?? null },
    outcome: r.outcome,
    findings,
    visit: visit
      ? { arrivedAt: visit.arrivalAt?.toISOString(), submittedAt: visit.submittedAt?.toISOString(), distanceFromTargetM: visit.distanceFromTargetM, gpsAccuracyM: visit.arrivalAccuracyM, withinThreshold: visit.withinThreshold, thresholdM: visit.thresholdM, applicantConfirmed: !!visit.applicantConfirmedAt, evidenceCount: visit.evidence.length }
      : null,
  };
  const sourceJson = canonical(snapshot);

  let summary = templateSummary(r.outcome, findings);
  let aiAssisted = false;
  const ai = await runAi({ feature: 'REPORT_SUMMARY', subjectType: 'VerificationRequest', subjectId: r.id, requestId: r.id, organisationId: r.organisationId, promptVersion: REPORT_SUMMARY_PROMPT_VERSION }, (model) =>
    deps().ai.generateText({ model, system: REPORT_SUMMARY_SYSTEM, prompt: `Findings JSON:\n${sourceJson}`, maxTokens: 400 }),
  );
  if (ai.data && ai.data.trim().length > 40 && !summaryIntroducesNewNumbers(ai.data, sourceJson)) {
    summary = ai.data.trim().slice(0, 1500);
    aiAssisted = true;
  }

  const ref = reference('AVN-RPT');
  const contentHash = sha256Hex(canonical({ ...snapshot, summary, reference: ref, version, issuedAt: issuedAt.toISOString() }));
  const signature = hmacHex(env.REPORT_SIGNING_SECRET, `${ref}.${contentHash}`);
  const verifyUrl = `${env.APPLICANT_APP_URL}/reports/verify?ref=${ref}&h=${contentHash.slice(0, 16)}`;

  const evidenceImages = await Promise.all(
    (visit?.evidence ?? [])
      .filter((e) => e.category !== 'VIDEO_WALKTHROUGH')
      .slice(0, 6)
      .map(async (e) => {
        const f = await prisma.storedFile.findUnique({ where: { id: e.fileId } });
        const image = f && (f.mimeType === 'image/jpeg' || f.mimeType === 'image/png') ? await storage.get(f.storageKey).catch(() => undefined) : undefined;
        return { category: e.category, capturedAt: e.capturedAt, distanceM: e.distanceFromTargetM, image };
      }),
  );

  const pdf = await renderReportPdf({
    reference: ref,
    version,
    requestReference: r.reference,
    issuedAt,
    validUntil,
    outcome: r.outcome,
    outcomeLabel: OUTCOME_LABELS[r.outcome],
    rulesVersion: findings[0]?.rulesVersion ?? 'n/a',
    organisationName: r.organisation?.legalName,
    customerReference: r.customerReference ?? undefined,
    applicantName: r.applicantName,
    addressLines: addressLines(r.address),
    level: r.level,
    findings: findings.map((f) => ({ label: FINDING_LABELS[f.key], value: VALUE_LABELS[f.value], basis: f.basis.join('. ') })),
    visit: visit
      ? { verifierCode: `VRF-${visit.verifier.id.slice(0, 8).toUpperCase()}`, arrivedAt: visit.arrivalAt ?? undefined, submittedAt: visit.submittedAt ?? undefined, distanceFromTargetM: visit.distanceFromTargetM, gpsAccuracyM: visit.arrivalAccuracyM, withinThreshold: visit.withinThreshold, thresholdM: visit.thresholdM, applicantConfirmed: !!visit.applicantConfirmedAt }
      : undefined,
    summary,
    aiAssisted,
    evidence: evidenceImages,
    contentHash,
    verifyUrl,
    timezone: 'Africa/Lagos',
  });
  const file = await storeFile({ data: pdf, allowed: ['application/pdf'], purpose: 'report', organisationId: r.organisationId });
  const report = await prisma.verificationReport.create({
    data: { requestId: r.id, version, reference: ref, outcome: r.outcome, findingsSnapshot: snapshot as object, rulesVersion: findings[0]?.rulesVersion ?? 'n/a', summary, aiAssisted, contentHash, signature, fileId: file.id, issuedAt, validUntil },
  });
  // Older versions remain on record but are superseded.
  await prisma.verificationReport.updateMany({ where: { requestId: r.id, id: { not: report.id }, revokedAt: null }, data: { revokedAt: issuedAt, revokedReason: `Superseded by ${ref}` } });
  await audit(SYSTEM('reporting'), 'report.issued', 'VerificationReport', report.id, { reference: ref, version, aiAssisted }, { organisationId: r.organisationId });
  if (r.organisationId) await emitWebhook(r.organisationId, 'report.issued', { requestId: r.id, reference: r.reference, reportReference: ref, outcome: r.outcome, contentHash });
  if (r.applicantUserId) await notifyUser(r.applicantUserId, 'request.completed', { reference: r.reference }, { channels: ['PUSH'], data: { requestId: r.id } });
  return report;
}

export function verifySignature(ref: string, contentHash: string, signature: string): boolean {
  return hmacHex(deps().env.REPORT_SIGNING_SECRET, `${ref}.${contentHash}`) === signature;
}

registerJob<{ requestId: string }>('reports.generate', async ({ requestId }) => {
  await generateReport(requestId);
});
