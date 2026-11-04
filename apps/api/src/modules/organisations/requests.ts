import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { cancelSchema, disputeSchema, institutionRequestSchema, requestFiltersSchema, STATUS_LABELS, type InstitutionRequestInput } from '@avn/contracts';
import type { Prisma } from '@avn/database';
import { normalisePhone } from '@avn/shared-utils';
import { deps } from '../../container';
import { actorFrom, audit } from '../../lib/audit';
import { orgCan, requireOrg } from '../../lib/auth';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { upload } from '../../lib/files';
import { paged, routes, uuidParam } from '../../lib/http';
import { enqueue, registerJob } from '../../lib/jobs';
import { withTx } from '../../lib/tx';
import { requestDetail } from '../requests/detail';
import { cancelRequest, createInstitutionRequest, issueApplicantInvitation, sendInvitation } from '../requests/service';

export const orgRequestRoutes = routes('/org/requests', 'Institutions');

export function requestWhere(orgId: string, f: z.infer<typeof requestFiltersSchema>): Prisma.VerificationRequestWhereInput {
  return {
    organisationId: orgId,
    deletedAt: null,
    ...(f.status ? { status: f.status } : {}),
    ...(f.level ? { level: f.level } : {}),
    ...(f.department ? { department: f.department } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    ...(f.state || f.city ? { address: { ...(f.state ? { state: { equals: f.state, mode: 'insensitive' as const } } : {}), ...(f.city ? { city: { equals: f.city, mode: 'insensitive' as const } } : {}) } } : {}),
    ...(f.verifierId ? { assignments: { some: { verifierId: f.verifierId } } } : {}),
    ...(f.risk === 'flagged' ? { riskFlagged: true } : f.risk === 'clear' ? { riskFlagged: false } : {}),
    ...(f.q
      ? { OR: [{ reference: { contains: f.q, mode: 'insensitive' as const } }, { customerReference: { contains: f.q, mode: 'insensitive' as const } }, { applicantName: { contains: f.q, mode: 'insensitive' as const } }, { applicantPhone: { contains: f.q } }] }
      : {}),
  };
}

orgRequestRoutes.get('/', { summary: 'Search and filter verification requests', guard: requireOrg('requests.read'), query: requestFiltersSchema }, async (ctx) => {
  const where = requestWhere(ctx.auth.org!.id, ctx.query);
  const [items, total] = await Promise.all([
    deps().prisma.verificationRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (ctx.query.page - 1) * ctx.query.pageSize,
      take: ctx.query.pageSize,
      include: { address: { select: { city: true, state: true } }, assignments: { where: { status: { notIn: ['RELEASED', 'CANCELLED'] } }, take: 1, select: { verifierId: true } } },
    }),
    deps().prisma.verificationRequest.count({ where }),
  ]);
  return paged(
    items.map((r) => ({
      id: r.id,
      reference: r.reference,
      customerReference: r.customerReference,
      applicantName: r.applicantName,
      status: r.status,
      statusLabel: STATUS_LABELS[r.status],
      outcome: r.outcome,
      level: r.level,
      priority: r.priority,
      department: r.department,
      location: [r.address?.city, r.address?.state].filter(Boolean).join(', '),
      verifierCode: r.assignments[0] ? `VRF-${r.assignments[0].verifierId.slice(0, 8).toUpperCase()}` : null,
      riskFlagged: r.riskFlagged,
      createdAt: r.createdAt,
      deadline: r.deadline,
    })),
    total,
    ctx.query.page,
    ctx.query.pageSize,
  );
});

orgRequestRoutes.post('/', { summary: 'Create a verification request and secure applicant invitation link', guard: requireOrg('requests.create'), body: institutionRequestSchema }, async (ctx, _req, res) => {
  const result = await withTx((tx, after) =>
    createInstitutionRequest(tx, after, { organisationId: ctx.auth.org!.id, source: 'INSTITUTION', createdByUserId: ctx.auth.user!.id, actor: actorFrom(ctx) }, ctx.body),
  );
  res.status(201);
  return { id: result.request.id, reference: result.request.reference, status: result.request.status, invitationUrl: result.invitationUrl, invitationExpiresAt: result.invitationExpiresAt };
});

orgRequestRoutes.get('/:id', { summary: 'Request detail: findings, GPS, evidence links, reports, disputes', guard: requireOrg('requests.read') }, async (ctx) => {
  const id = uuidParam(ctx);
  const detail = await requestDetail(id, { organisationId: ctx.auth.org!.id, includeEvidence: orgCan(ctx.auth, 'evidence.read') });
  if (orgCan(ctx.auth, 'evidence.read')) await audit(actorFrom(ctx), 'evidence.viewed', 'VerificationRequest', id);
  return detail;
});

orgRequestRoutes.post('/:id/cancel', { summary: 'Cancel a request (refunds when no field work started)', guard: requireOrg('requests.cancel'), body: cancelSchema }, async (ctx) => {
  const id = uuidParam(ctx);
  const r = await deps().prisma.verificationRequest.findFirst({ where: { id, organisationId: ctx.auth.org!.id } });
  if (!r) throw notFound('Verification request');
  await withTx((tx, after) => cancelRequest(tx, after, id, ctx.body.reason, { type: 'INSTITUTION', id: ctx.auth.user!.id }, actorFrom(ctx)));
  return { status: 'CANCELLED' };
});

orgRequestRoutes.post('/:id/invitation', { summary: 'Regenerate the invitation link (optionally resend by SMS/email)', guard: requireOrg('requests.create'), body: z.object({ send: z.boolean().default(true) }) }, async (ctx) => {
  const id = uuidParam(ctx);
  const r = await deps().prisma.verificationRequest.findFirst({ where: { id, organisationId: ctx.auth.org!.id } });
  if (!r) throw notFound('Verification request');
  if (r.status !== 'AWAITING_APPLICANT') throw conflict('The applicant has already submitted');
  const inv = await withTx((tx) => issueApplicantInvitation(tx, r.id, r.applicantPhone, r.applicantEmail));
  if (ctx.body.send) await sendInvitation(r.id, inv.url);
  await audit(actorFrom(ctx), 'invitation.regenerated', 'VerificationRequest', r.id, { sent: ctx.body.send });
  return { invitationUrl: inv.url, expiresAt: inv.expiresAt };
});

orgRequestRoutes.post('/:id/disputes', { summary: 'Raise a dispute on a report', guard: requireOrg('reports.dispute'), body: disputeSchema }, async (ctx) => {
  const id = uuidParam(ctx);
  const r = await deps().prisma.verificationRequest.findFirst({ where: { id, organisationId: ctx.auth.org!.id }, include: { reports: { where: { revokedAt: null }, take: 1, orderBy: { version: 'desc' } } } });
  if (!r) throw notFound('Verification request');
  if (!r.outcome) throw conflict('No completed verification to dispute');
  const d = await deps().prisma.verificationDispute.create({ data: { requestId: r.id, reportId: r.reports[0]?.id, raisedByUserId: ctx.auth.user!.id, raisedByType: 'INSTITUTION', reason: ctx.body.reason, details: ctx.body.details } });
  await audit(actorFrom(ctx), 'dispute.raised', 'VerificationDispute', d.id, { by: 'INSTITUTION' });
  return { id: d.id, status: d.status };
});

orgRequestRoutes.post('/:id/reverify', { summary: 'Request an additional verification for the same applicant', guard: requireOrg('requests.create'), body: z.object({ level: z.enum(['BASIC', 'STANDARD', 'ENHANCED']).optional(), instructions: z.string().max(1000).optional() }) }, async (ctx) => {
  const id = uuidParam(ctx);
  const r = await deps().prisma.verificationRequest.findFirst({ where: { id, organisationId: ctx.auth.org!.id }, include: { address: true } });
  if (!r) throw notFound('Verification request');
  const input: InstitutionRequestInput = {
    applicantName: r.applicantName,
    applicantPhone: r.applicantPhone,
    applicantEmail: r.applicantEmail ?? undefined,
    customerReference: `${r.customerReference ?? r.reference}-R${Date.now().toString(36).slice(-4).toUpperCase()}`,
    level: ctx.body.level ?? r.level,
    purpose: r.purpose,
    priority: r.priority,
    instructions: ctx.body.instructions ?? `Additional verification following ${r.reference}`,
    department: r.department ?? undefined,
    sendInvitation: true,
  };
  const result = await withTx((tx, after) => createInstitutionRequest(tx, after, { organisationId: ctx.auth.org!.id, source: 'INSTITUTION', createdByUserId: ctx.auth.user!.id, actor: actorFrom(ctx) }, input));
  return { id: result.request.id, reference: result.request.reference, invitationUrl: result.invitationUrl };
});

// ─── Bulk CSV (spec C6) ──────────────────────────────────────────────────────
export const bulkRoutes = routes('/org/bulk', 'Institutions');
const CSV_COLUMNS = ['applicant_name', 'applicant_phone', 'applicant_email', 'customer_reference', 'level', 'purpose', 'priority', 'department', 'instructions'] as const;
const MAX_ROWS = 5000;

export interface BulkError {
  row: number;
  field: string;
  message: string;
}

export async function validateCsv(orgId: string, countryCode: string, buf: Buffer) {
  let records: Record<string, string>[];
  try {
    records = parse(buf, { columns: (h: string[]) => h.map((x) => x.trim().toLowerCase()), skip_empty_lines: true, trim: true, bom: true });
  } catch (err) {
    throw badRequest(`Could not parse CSV: ${err instanceof Error ? err.message : 'invalid file'}`);
  }
  if (records.length === 0) throw badRequest('The CSV has no data rows');
  if (records.length > MAX_ROWS) throw badRequest(`A maximum of ${MAX_ROWS} rows is supported per file`);
  const errors: BulkError[] = [];
  const valid: Array<{ row: number; input: InstitutionRequestInput }> = [];
  const seen = new Map<string, number>();
  const refs = records.map((r) => r.customer_reference).filter((x): x is string => !!x);
  const existing = new Set(
    (await deps().prisma.verificationRequest.findMany({ where: { organisationId: orgId, customerReference: { in: refs }, status: { notIn: ['CANCELLED', 'EXPIRED', 'COMPLETED', 'PARTIALLY_VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE'] } }, select: { customerReference: true } })).map((x) => x.customerReference),
  );
  records.forEach((rec, i) => {
    const row = i + 2; // header is row 1
    const rowErrors: BulkError[] = [];
    for (const col of ['applicant_name', 'applicant_phone', 'customer_reference'] as const) if (!rec[col]) rowErrors.push({ row, field: col, message: 'Required field missing' });
    if (rec.applicant_phone && !normalisePhone(rec.applicant_phone, countryCode)) rowErrors.push({ row, field: 'applicant_phone', message: 'Invalid phone number' });
    if (rec.applicant_email && !z.string().email().safeParse(rec.applicant_email).success) rowErrors.push({ row, field: 'applicant_email', message: 'Invalid email address' });
    if (rec.customer_reference) {
      if (seen.has(rec.customer_reference)) rowErrors.push({ row, field: 'customer_reference', message: `Duplicate of row ${seen.get(rec.customer_reference)}` });
      else seen.set(rec.customer_reference, row);
      if (existing.has(rec.customer_reference)) rowErrors.push({ row, field: 'customer_reference', message: 'An active verification already exists for this reference' });
    }
    const parsed = institutionRequestSchema.safeParse({
      applicantName: rec.applicant_name,
      applicantPhone: rec.applicant_phone,
      applicantEmail: rec.applicant_email || undefined,
      customerReference: rec.customer_reference,
      level: (rec.level || 'STANDARD').toUpperCase(),
      purpose: (rec.purpose || 'BANK_ACCOUNT').toUpperCase(),
      priority: (rec.priority || 'NORMAL').toUpperCase(),
      department: rec.department || undefined,
      instructions: rec.instructions || undefined,
      sendInvitation: true,
    });
    if (!parsed.success && rowErrors.length === 0) for (const iss of parsed.error.issues) rowErrors.push({ row, field: String(iss.path[0] ?? ''), message: iss.message });
    if (rowErrors.length) errors.push(...rowErrors);
    else if (parsed.success) valid.push({ row, input: parsed.data });
  });
  return { total: records.length, valid, errors };
}

bulkRoutes.post('/', { summary: 'Upload a CSV for validation and preview', guard: requireOrg('bulk.upload'), upload: upload('file') }, async (ctx, _req, res) => {
  if (!ctx.file) throw badRequest('Attach a CSV file');
  if (ctx.file.size > 5 * 1024 * 1024) throw badRequest('CSV must be under 5 MB');
  const org = await deps().prisma.organisation.findUniqueOrThrow({ where: { id: ctx.auth.org!.id } });
  const v = await validateCsv(org.id, org.countryCode, ctx.file.buffer);
  const invalidRows = new Set(v.errors.map((e) => e.row)).size;
  const b = await deps().prisma.bulkUpload.create({
    data: { organisationId: org.id, uploadedById: ctx.auth.user!.id, fileName: ctx.file.originalname.slice(0, 200), totalRows: v.total, validRows: v.valid.length, invalidRows, rows: v.valid as unknown as object, errors: v.errors as unknown as object },
  });
  await audit(actorFrom(ctx), 'bulk.uploaded', 'BulkUpload', b.id, { total: v.total, valid: v.valid.length, invalid: invalidRows });
  res.status(201);
  return { id: b.id, totalRows: v.total, validRows: v.valid.length, invalidRows, errors: v.errors.slice(0, 200), preview: v.valid.slice(0, 10).map((x) => ({ row: x.row, ...x.input })), columns: CSV_COLUMNS };
});

bulkRoutes.get('/', { summary: 'Bulk upload history', guard: requireOrg('bulk.upload') }, async (ctx) =>
  deps().prisma.bulkUpload.findMany({ where: { organisationId: ctx.auth.org!.id }, orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, fileName: true, status: true, totalRows: true, validRows: true, invalidRows: true, processedRows: true, failedRows: true, createdAt: true, completedAt: true } }),
);

bulkRoutes.get('/:id/errors.csv', { summary: 'Download the validation/processing error report', guard: requireOrg('bulk.upload') }, async (ctx, _req, res) => {
  const b = await deps().prisma.bulkUpload.findFirst({ where: { id: uuidParam(ctx), organisationId: ctx.auth.org!.id } });
  if (!b) throw notFound('Bulk upload');
  const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
  const lines = ['row,field,message', ...(b.errors as unknown as BulkError[]).map((e) => [e.row, e.field, e.message].map(esc).join(','))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="bulk-${b.id.slice(0, 8)}-errors.csv"`);
  res.send(lines.join('\n'));
});

bulkRoutes.get('/template.csv', { summary: 'Download the CSV template', guard: requireOrg('bulk.upload') }, async (_ctx, _req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="avn-bulk-template.csv"');
  res.send(`${CSV_COLUMNS.join(',')}\nAda Example (fictional),08031234567,ada@example.com,CUST-0001,STANDARD,BANK_ACCOUNT,NORMAL,Retail,\n`);
});

bulkRoutes.post('/:id/confirm', { summary: 'Process the valid rows asynchronously', guard: requireOrg('bulk.upload') }, async (ctx) => {
  const { prisma } = deps();
  const { count } = await prisma.bulkUpload.updateMany({ where: { id: uuidParam(ctx), organisationId: ctx.auth.org!.id, status: 'VALIDATED' }, data: { status: 'PROCESSING' } });
  if (count === 0) throw conflict('This upload has already been processed or discarded');
  await audit(actorFrom(ctx), 'bulk.confirmed', 'BulkUpload', ctx.params.id!);
  await enqueue('bulk.process', { bulkId: ctx.params.id, actorUserId: ctx.auth.user!.id });
  return { status: 'PROCESSING' };
});

bulkRoutes.delete('/:id', { summary: 'Discard a validated upload', guard: requireOrg('bulk.upload') }, async (ctx) => {
  const { count } = await deps().prisma.bulkUpload.updateMany({ where: { id: uuidParam(ctx), organisationId: ctx.auth.org!.id, status: 'VALIDATED' }, data: { status: 'DISCARDED' } });
  if (count === 0) throw conflict('Only unprocessed uploads can be discarded');
  return { status: 'DISCARDED' };
});

/** Background processing — each row in its own transaction so one failure never blocks the batch. */
export async function processBulk(bulkId: string, actorUserId: string) {
  const { prisma } = deps();
  const b = await prisma.bulkUpload.findUnique({ where: { id: bulkId } });
  if (!b || b.status !== 'PROCESSING') return;
  const rows = b.rows as unknown as Array<{ row: number; input: InstitutionRequestInput }>;
  const errors = [...(b.errors as unknown as BulkError[])];
  let processed = b.processedRows;
  let failed = b.failedRows;
  for (const r of rows.slice(processed + failed)) {
    try {
      await withTx((tx, after) =>
        createInstitutionRequest(tx, after, { organisationId: b.organisationId, source: 'BULK', bulkUploadId: b.id, createdByUserId: actorUserId, actor: { system: 'bulk-processor' } }, r.input),
      );
      processed++;
    } catch (err) {
      failed++;
      errors.push({ row: r.row, field: 'processing', message: err instanceof Error ? err.message : 'Failed' });
    }
    if ((processed + failed) % 25 === 0) await prisma.bulkUpload.update({ where: { id: b.id }, data: { processedRows: processed, failedRows: failed, errors: errors as unknown as object } });
  }
  await prisma.bulkUpload.update({ where: { id: b.id }, data: { processedRows: processed, failedRows: failed, errors: errors as unknown as object, status: 'COMPLETED', completedAt: new Date() } });
}

registerJob<{ bulkId: string; actorUserId: string }>('bulk.process', async ({ bulkId, actorUserId }) => processBulk(bulkId, actorUserId));
