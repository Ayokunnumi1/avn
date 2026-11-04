import { z } from 'zod';
import { hmacHex, safeEqual } from '@avn/shared-utils/crypto';
import { deps } from '../../container';
import { actorFrom, audit } from '../../lib/audit';
import { adminCan, orgCan, requireAnyUser } from '../../lib/auth';
import type { AuthContext } from '../../lib/auth-context';
import { forbidden, notFound } from '../../lib/errors';
import { routes, uuidParam } from '../../lib/http';
import { consume } from '../../lib/rate-limit';
import { OUTCOME_LABELS } from '../verification/engine';
import { verifySignature } from './service';

export const reportRoutes = routes('/reports', 'Reports');

/** Who may read a report: the applicant, institution staff with reports.read, or reviewers. */
export async function canReadReport(auth: AuthContext, requestId: string): Promise<boolean> {
  const r = await deps().prisma.verificationRequest.findUnique({ where: { id: requestId }, select: { applicantUserId: true, organisationId: true } });
  if (!r) return false;
  if (auth.audience === 'applicant' && auth.user?.id === r.applicantUserId) return !auth.session?.scopeRequestId || auth.session.scopeRequestId === requestId;
  if (auth.audience === 'business' && auth.org?.id === r.organisationId && orgCan(auth, 'reports.read')) return true;
  if (auth.apiKey && auth.apiKey.organisationId === r.organisationId && auth.apiKey.scopes.includes('reports:read')) return true;
  if (auth.audience === 'admin' && (adminCan(auth, 'reviews.manage') || adminCan(auth, 'disputes.manage'))) return true;
  return false;
}

async function streamPdf(reportId: string, res: import('express').Response) {
  const { prisma, storage } = deps();
  const report = await prisma.verificationReport.findUnique({ where: { id: reportId } });
  if (!report?.fileId) throw notFound('Report');
  const file = await prisma.storedFile.findUniqueOrThrow({ where: { id: report.fileId } });
  const data = await storage.get(file.storageKey);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${report.reference}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(data);
}

reportRoutes.get('/:id/pdf', { summary: 'Download a report PDF (authorised users only)', guard: requireAnyUser }, async (ctx, _req, res) => {
  const report = await deps().prisma.verificationReport.findUnique({ where: { id: uuidParam(ctx) } });
  if (!report || !(await canReadReport(ctx.auth, report.requestId))) throw notFound('Report');
  await audit(actorFrom(ctx), 'report.downloaded', 'VerificationReport', report.id);
  await streamPdf(report.id, res);
});

reportRoutes.post('/:id/share', { summary: 'Create a 7-day share link for an authorised recipient', guard: requireAnyUser }, async (ctx) => {
  const report = await deps().prisma.verificationReport.findUnique({ where: { id: uuidParam(ctx) } });
  if (!report || !(await canReadReport(ctx.auth, report.requestId))) throw notFound('Report');
  if (report.revokedAt) throw forbidden('This report version has been superseded');
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  const sig = hmacHex(deps().env.REPORT_SIGNING_SECRET, `share.${report.id}.${exp}`);
  await audit(actorFrom(ctx), 'report.shared', 'VerificationReport', report.id, { exp });
  return { url: `/api/v1/reports/shared/${report.id}?exp=${exp}&sig=${sig}`, expiresAt: new Date(exp * 1000) };
});

reportRoutes.get('/shared/:id', { summary: 'Open a shared report link', public: true, query: z.object({ exp: z.coerce.number(), sig: z.string().length(64) }) }, async (ctx, _req, res) => {
  const id = uuidParam(ctx);
  if (ctx.query.exp < Date.now() / 1000 || !safeEqual(hmacHex(deps().env.REPORT_SIGNING_SECRET, `share.${id}.${ctx.query.exp}`), ctx.query.sig)) throw notFound('Report');
  await audit({ ip: ctx.ip, userAgent: ctx.userAgent }, 'report.shared_opened', 'VerificationReport', id);
  await streamPdf(id, res);
});

reportRoutes.get(
  '/verify/:reference',
  { summary: 'Public authenticity check. Outcome is disclosed only when the caller proves possession of the report hash.', public: true, query: z.object({ h: z.string().regex(/^[a-f0-9]{8,64}$/).optional() }) },
  async (ctx) => {
    await consume('report-verify', ctx.ip, 30, 60);
    const ref = z.string().regex(/^AVN-RPT-[A-Z0-9]{8}$/).parse(ctx.params.reference);
    const report = await deps().prisma.verificationReport.findUnique({ where: { reference: ref } });
    if (!report) return { reference: ref, valid: false, status: 'NOT_FOUND' };
    const signatureOk = verifySignature(report.reference, report.contentHash, report.signature);
    const status = !signatureOk ? 'TAMPERED' : report.revokedAt ? 'SUPERSEDED' : report.validUntil < new Date() ? 'EXPIRED' : 'VALID';
    const holdsCopy = !!ctx.query.h && report.contentHash.startsWith(ctx.query.h);
    return {
      reference: report.reference,
      valid: status === 'VALID',
      status,
      issuedAt: report.issuedAt,
      validUntil: report.validUntil,
      issuer: 'AVN Digital Address Verification Network',
      ...(holdsCopy ? { outcome: report.outcome, outcomeLabel: OUTCOME_LABELS[report.outcome], contentHashMatches: true } : { note: 'Provide the hash printed on the report to confirm its outcome.' }),
    };
  },
);
