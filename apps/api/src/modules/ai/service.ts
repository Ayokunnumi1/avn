import { estimateCostUsd, type AiResult } from '@avn/ai';
import type { AiFeature } from '@avn/contracts';
import { Prisma } from '@avn/database';
import { deps } from '../../container';
import { getAiConfig } from '../../lib/settings';

export interface AiRunOptions {
  feature: AiFeature;
  subjectType: string;
  subjectId: string;
  requestId?: string | null;
  organisationId?: string | null;
  promptVersion: string;
}

/** Month-to-date AI spend, used to enforce the configured monthly budget. */
export async function monthSpendUsd(): Promise<number> {
  const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const agg = await deps().prisma.aiUsageRecord.aggregate({ where: { createdAt: { gte: start } }, _sum: { costUsd: true } });
  return Number(agg._sum.costUsd ?? 0);
}

/**
 * Wraps every AI call with cost control (spec §4.6): feature enablement, per-feature model
 * selection, monthly budget, usage tracking and an AiAnalysis record. Never throws —
 * callers always have a deterministic fallback, so the platform keeps working without AI.
 */
export async function runAi<T>(opts: AiRunOptions, call: (model: string) => Promise<AiResult<T>>): Promise<{ data: T | null; analysisId: string | null; reason?: string }> {
  const { prisma, ai, log } = deps();
  const cfg = await getAiConfig();
  const feature = cfg.features[opts.feature];
  const base = { feature: opts.feature, subjectType: opts.subjectType, subjectId: opts.subjectId, requestId: opts.requestId ?? null, provider: ai.name, promptVersion: opts.promptVersion };
  if (!ai.enabled || !cfg.enabled || !feature?.enabled) return { data: null, analysisId: null, reason: 'DISABLED' };
  if ((await monthSpendUsd()) >= cfg.monthlyBudgetUsd) {
    const rec = await prisma.aiAnalysis.create({ data: { ...base, model: feature.model, status: 'SKIPPED', error: 'Monthly AI budget reached' } });
    return { data: null, analysisId: rec.id, reason: 'BUDGET_EXCEEDED' };
  }
  let result: AiResult<T>;
  try {
    result = await call(feature.model);
  } catch (err) {
    result = { ok: false, reason: 'PROVIDER_ERROR', error: String(err), provider: ai.name, latencyMs: 0 };
  }
  if (result.usage) {
    await prisma.aiUsageRecord.create({
      data: {
        feature: opts.feature,
        provider: ai.name,
        model: result.model ?? feature.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        images: result.usage.images,
        costUsd: new Prisma.Decimal(estimateCostUsd(result.model ?? feature.model, result.usage).toFixed(6)),
        organisationId: opts.organisationId ?? null,
        succeeded: result.ok,
      },
    });
  }
  if (!result.ok) {
    log.warn({ feature: opts.feature, reason: result.reason, error: result.error }, 'AI call failed — using deterministic fallback');
    const rec = await prisma.aiAnalysis.create({ data: { ...base, model: result.model ?? feature.model, status: 'FAILED', error: `${result.reason}: ${result.error}`.slice(0, 500), latencyMs: result.latencyMs } });
    return { data: null, analysisId: rec.id, reason: result.reason };
  }
  const d = result.data as unknown as { confidence?: number; explanation?: string; nextAction?: string };
  const rec = await prisma.aiAnalysis.create({
    data: {
      ...base,
      model: result.model,
      status: 'SUCCEEDED',
      findings: result.data as unknown as object,
      confidence: typeof d?.confidence === 'number' ? Math.max(0, Math.min(1, d.confidence)) : null,
      explanation: typeof d?.explanation === 'string' ? d.explanation.slice(0, 2000) : null,
      nextAction: typeof d?.nextAction === 'string' ? d.nextAction.slice(0, 500) : null,
      latencyMs: result.latencyMs,
    },
  });
  return { data: result.data, analysisId: rec.id };
}
