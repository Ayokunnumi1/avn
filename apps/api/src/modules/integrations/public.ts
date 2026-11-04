import type { NextFunction, Request, Response } from 'express';
import { institutionRequestSchema, STATUS_LABELS } from '@avn/contracts';
import { deps } from '../../container';
import { requireApiKey } from '../../lib/auth';
import { notFound } from '../../lib/errors';
import { routes } from '../../lib/http';
import { consume } from '../../lib/rate-limit';
import { withTx } from '../../lib/tx';
import { createInstitutionRequest } from '../requests/service';

/** Public REST API for institutions (API-key auth, per-key rate limit, usage logging). */
export const publicApiRoutes = routes('/integrations', 'Public API');

export function apiUsageLogger(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.kind !== 'apiKey') return next();
  const started = Date.now();
  const key = req.auth.apiKey!;
  res.on('finish', () => {
    const { prisma } = deps();
    void prisma.apiRequestLog
      .create({ data: { credentialId: key.id, organisationId: key.organisationId, method: req.method, path: req.originalUrl.split('?')[0]!.slice(0, 200), statusCode: res.statusCode, durationMs: Date.now() - started } })
      .then(() => prisma.apiCredential.update({ where: { id: key.id }, data: { requestCount: { increment: 1 }, lastUsedAt: new Date() } }))
      .catch(() => undefined);
  });
  consume('api-key', key.id, 120, 60).then(() => next(), next);
}

const view = (r: { id: string; reference: string; customerReference: string | null; status: keyof typeof STATUS_LABELS; outcome: string | null; createdAt: Date; updatedAt: Date; outcomeAt: Date | null }, report?: { id: string; reference: string; contentHash: string; issuedAt: Date } | null) => ({
  id: r.id,
  reference: r.reference,
  customerReference: r.customerReference,
  status: r.status,
  statusLabel: STATUS_LABELS[r.status],
  outcome: r.outcome,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  completedAt: r.outcomeAt,
  report: report ? { id: report.id, reference: report.reference, contentHash: report.contentHash, issuedAt: report.issuedAt, pdfUrl: `/api/v1/integrations/verifications/${r.id}/report.pdf` } : null,
});

publicApiRoutes.post('/verifications', { summary: 'Create a verification request (Idempotency-Key header supported)', guard: requireApiKey('requests:write'), body: institutionRequestSchema }, async (ctx, req, res) => {
  const key = ctx.auth.apiKey!;
  const idem = String(req.headers['idempotency-key'] ?? '').slice(0, 100);
  if (idem) {
    const prior = await deps().prisma.verificationRequest.findFirst({ where: { organisationId: key.organisationId, apiCredentialId: key.id, customerReference: ctx.body.customerReference, source: 'API' } });
    if (prior) return view(prior);
  }
  const result = await withTx((tx, after) => createInstitutionRequest(tx, after, { organisationId: key.organisationId, source: 'API', apiCredentialId: key.id, actor: { auth: ctx.auth, ip: ctx.ip, userAgent: ctx.userAgent } }, ctx.body));
  res.status(201);
  return { ...view(result.request), invitationUrl: result.invitationUrl };
});

publicApiRoutes.get('/verifications/:id', { summary: 'Retrieve status by id or reference', guard: requireApiKey('requests:read') }, async (ctx) => {
  const idOrRef = ctx.params.id!;
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrRef);
  const r = await deps().prisma.verificationRequest.findFirst({
    where: { organisationId: ctx.auth.apiKey!.organisationId, ...(isUuid ? { id: idOrRef } : { reference: idOrRef }) },
    include: { reports: { where: { revokedAt: null }, orderBy: { version: 'desc' }, take: 1 } },
  });
  if (!r) throw notFound('Verification');
  return view(r, r.reports[0]);
});

publicApiRoutes.get('/verifications/:id/report.pdf', { summary: 'Download the current report PDF', guard: requireApiKey('reports:read') }, async (ctx, _req, res) => {
  const { prisma, storage } = deps();
  const r = await prisma.verificationRequest.findFirst({ where: { id: ctx.params.id!, organisationId: ctx.auth.apiKey!.organisationId }, include: { reports: { where: { revokedAt: null }, orderBy: { version: 'desc' }, take: 1 } } });
  const rep = r?.reports[0];
  if (!rep?.fileId) throw notFound('Report');
  const file = await prisma.storedFile.findUniqueOrThrow({ where: { id: rep.fileId } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${rep.reference}.pdf"`);
  res.end(await storage.get(file.storageKey));
});
