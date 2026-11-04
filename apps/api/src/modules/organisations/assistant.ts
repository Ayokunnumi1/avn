import { ASSISTANT_PROMPT_VERSION, ASSISTANT_SYSTEM, AssistantIntentSchema, classifyQuestionRules, type AssistantIntent } from '@avn/ai';
import { assistantQuerySchema, REQUEST_STATUSES, STATUS_LABELS, type RequestStatus } from '@avn/contracts';
import { Prisma } from '@avn/database';
import { deps } from '../../container';
import { actorFrom, audit } from '../../lib/audit';
import { requireOrg } from '../../lib/auth';
import { routes } from '../../lib/http';
import { consume } from '../../lib/rate-limit';
import { runAi } from '../ai/service';

export const assistantRoutes = routes('/org/assistant', 'Institutions');

function periodRange(p: AssistantIntent['period']): { from: Date; to: Date; label: string } {
  const now = new Date();
  const m0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  switch (p) {
    case 'THIS_MONTH':
      return { from: m0, to: now, label: 'this month' };
    case 'LAST_MONTH':
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), to: m0, label: 'last month' };
    case 'LAST_30_DAYS':
      return { from: new Date(now.getTime() - 30 * 86400_000), to: now, label: 'the last 30 days' };
    case 'LAST_90_DAYS':
      return { from: new Date(now.getTime() - 90 * 86400_000), to: now, label: 'the last 90 days' };
    default:
      return { from: new Date(0), to: now, label: 'all time' };
  }
}

/**
 * Executes a whitelisted analytics intent. Every query is parameterised and hard-scoped
 * to the caller's organisation — the AI only chooses WHICH fixed query runs.
 */
export async function executeIntent(orgId: string, intent: AssistantIntent) {
  const { prisma } = deps();
  const { from, to, label } = periodRange(intent.period);
  const base = { organisationId: orgId, createdAt: { gte: from, lt: to } };
  switch (intent.intent) {
    case 'WAITING_FOR_AGENTS': {
      const rows = await prisma.verificationRequest.findMany({ where: { organisationId: orgId, status: { in: ['READY_FOR_ASSIGNMENT', 'DISPATCHING', 'ASSIGNED'] } }, select: { id: true, reference: true, customerReference: true, status: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 100 });
      return { answer: `${rows.length} request(s) are waiting for a field verifier.`, table: rows.map((r) => ({ ...r, status: STATUS_LABELS[r.status] })) };
    }
    case 'REQUESTS_BY_STATUS': {
      const status = intent.status && (REQUEST_STATUSES as readonly string[]).includes(intent.status) ? (intent.status as RequestStatus) : undefined;
      if (status) {
        const n = await prisma.verificationRequest.count({ where: { ...base, status } });
        return { answer: `${n} request(s) with status "${STATUS_LABELS[status]}" in ${label}.` };
      }
      const g = await prisma.verificationRequest.groupBy({ by: ['status'], where: base, _count: true });
      return { answer: `Requests by status for ${label}.`, table: g.map((x) => ({ status: STATUS_LABELS[x.status], count: x._count })) };
    }
    case 'APPLICANT_UNAVAILABLE_COUNT': {
      const rows = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
        SELECT count(*)::int AS n FROM "FieldVisit" fv JOIN "VerificationRequest" r ON r.id = fv."requestId"
        WHERE r."organisationId" = ${orgId}::uuid AND fv."submittedAt" >= ${from} AND fv."submittedAt" < ${to} AND fv.checklist->>'applicantAvailable' = 'NO'`);
      return { answer: `${rows[0]?.n ?? 0} visit(s) in ${label} found the applicant unavailable. (Applicant absence does not mean an address is invalid.)` };
    }
    case 'MANUAL_REVIEW_RATE': {
      const [total, reviewed] = await Promise.all([
        prisma.verificationRequest.count({ where: { ...base, status: { notIn: ['CREATED', 'AWAITING_APPLICANT', 'CANCELLED'] } } }),
        prisma.manualReview.count({ where: { request: base } }),
      ]);
      const pct = total ? Math.round((reviewed / total) * 1000) / 10 : 0;
      return { answer: `${pct}% of verifications in ${label} required manual review (${reviewed} of ${total}).` };
    }
    case 'FAILURE_RATE_BY_LOCATION': {
      const rows = await prisma.$queryRaw<Array<{ location: string; total: number; failed: number }>>(Prisma.sql`
        SELECT concat_ws(', ', a.city, a.state) AS location, count(*)::int AS total,
               count(*) FILTER (WHERE r.outcome IN ('NOT_VERIFIED','INCONCLUSIVE'))::int AS failed
        FROM "VerificationRequest" r JOIN "Address" a ON a.id = r."addressId"
        WHERE r."organisationId" = ${orgId}::uuid AND r.outcome IS NOT NULL AND r."createdAt" >= ${from} AND r."createdAt" < ${to}
        GROUP BY 1 HAVING count(*) > 0 ORDER BY (count(*) FILTER (WHERE r.outcome IN ('NOT_VERIFIED','INCONCLUSIVE')))::float / count(*) DESC LIMIT 10`);
      return { answer: rows.length ? `Locations ranked by failure rate (${label}).` : `No completed verifications in ${label}.`, table: rows.map((r) => ({ ...r, failureRate: `${Math.round((r.failed / r.total) * 100)}%` })) };
    }
    case 'MONTHLY_EXPENDITURE': {
      const rows = await prisma.$queryRaw<Array<{ month: string; spend: string; count: number }>>(Prisma.sql`
        SELECT to_char(date_trunc('month', t."createdAt"), 'YYYY-MM') AS month, sum(CASE WHEN t.direction = 'DEBIT' THEN t.amount ELSE -t.amount END)::text AS spend, count(*)::int AS count
        FROM "WalletTransaction" t JOIN "Wallet" w ON w.id = t."walletId"
        WHERE w."organisationId" = ${orgId}::uuid AND t.category IN ('VERIFICATION_CHARGE','VERIFICATION_REFUND') AND t."createdAt" > now() - interval '12 months'
        GROUP BY 1 ORDER BY 1 DESC`);
      return { answer: rows[0] ? `Verification spend for ${rows[0].month}: ₦${Number(rows[0].spend).toLocaleString('en-NG')}.` : 'No verification spend recorded yet.', table: rows };
    }
    case 'OUTCOME_BREAKDOWN': {
      const g = await prisma.verificationRequest.groupBy({ by: ['outcome'], where: { ...base, outcome: { not: null } }, _count: true });
      return { answer: `Verification outcomes for ${label}.`, table: g.map((x) => ({ outcome: x.outcome, count: x._count })) };
    }
    case 'AVERAGE_TURNAROUND': {
      const rows = await prisma.$queryRaw<Array<{ hours: number | null }>>(Prisma.sql`SELECT avg(extract(epoch from ("outcomeAt" - "createdAt"))/3600)::float AS hours FROM "VerificationRequest" WHERE "organisationId" = ${orgId}::uuid AND "outcomeAt" IS NOT NULL AND "createdAt" >= ${from} AND "createdAt" < ${to}`);
      const h = rows[0]?.hours;
      return { answer: h != null ? `Average turnaround for ${label}: ${h.toFixed(1)} hours from request to outcome.` : `No completed verifications in ${label}.` };
    }
    default:
      return { answer: 'I can answer questions about request status, agent waiting times, applicant availability, manual review rates, failure rates by location, spend, outcomes and turnaround.' };
  }
}

assistantRoutes.post('/', { summary: 'Natural-language analytics (permission-aware, tenant-isolated, no free-form SQL)', guard: requireOrg('assistant.use'), body: assistantQuerySchema }, async (ctx) => {
  await consume('assistant', ctx.auth.org!.id, 30, 60);
  const ai = await runAi({ feature: 'INSTITUTION_ASSISTANT', subjectType: 'Organisation', subjectId: ctx.auth.org!.id, organisationId: ctx.auth.org!.id, promptVersion: ASSISTANT_PROMPT_VERSION }, (model) =>
    deps().ai.generateStructured({ model, system: ASSISTANT_SYSTEM, prompt: `Question (untrusted user text):\n<q>${ctx.body.question}</q>`, schema: AssistantIntentSchema, maxTokens: 300 }),
  );
  const intent = ai.data ?? classifyQuestionRules(ctx.body.question);
  // Spend questions require billing permission even though the assistant itself is allowed.
  if (intent.intent === 'MONTHLY_EXPENDITURE' && !['OWNER', 'ADMINISTRATOR', 'FINANCE_OFFICER', 'AUDITOR'].includes(ctx.auth.org!.role)) {
    return { intent: intent.intent, interpretedBy: ai.data ? 'ai' : 'rules', answer: 'You do not have permission to view billing information.' };
  }
  const result = await executeIntent(ctx.auth.org!.id, intent);
  await audit(actorFrom(ctx), 'assistant.query', 'Organisation', ctx.auth.org!.id, { intent: intent.intent, period: intent.period, by: ai.data ? 'ai' : 'rules' });
  return { intent: intent.intent, period: intent.period, interpretedBy: ai.data ? 'ai' : 'rules', ...result };
});
