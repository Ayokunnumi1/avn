import { z } from 'zod';
import { DEFAULT_PLATFORM_CONFIG, platformConfigSchema, aiConfigSchema, AI_FEATURES, type PlatformConfig } from '@avn/contracts';
import { deps } from '../container';

export type AiConfig = z.infer<typeof aiConfigSchema>;
export function defaultAiConfig(): AiConfig {
  const env = deps().env;
  return {
    enabled: env.AI_PROVIDER !== 'disabled',
    features: Object.fromEntries(
      AI_FEATURES.map((f) => [f, { enabled: true, model: f === 'EVIDENCE_QUALITY' || f === 'OCR' ? env.AI_MODEL_VISION : env.AI_MODEL_TEXT }]),
    ) as AiConfig['features'],
    monthlyBudgetUsd: env.AI_MONTHLY_BUDGET_USD,
    maxImagesPerVisit: 6,
    riskReviewThreshold: 60,
  };
}

const cache = new Map<string, { at: number; value: unknown }>();
const TTL = 15_000;

async function load<T>(key: string, schema: z.ZodType<T>, fallback: () => T): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  const row = await deps().prisma.platformSetting.findUnique({ where: { key } });
  const parsed = row ? schema.safeParse({ ...(fallback() as object), ...(row.value as object) }) : null;
  const value = parsed?.success ? parsed.data : fallback();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export const getPlatformConfig = (): Promise<PlatformConfig> => load('platform', platformConfigSchema, () => DEFAULT_PLATFORM_CONFIG);
export const getAiConfig = (): Promise<AiConfig> => load('ai', aiConfigSchema, defaultAiConfig);

export async function saveSetting(key: 'platform' | 'ai', value: object, userId: string | null): Promise<void> {
  await deps().prisma.platformSetting.upsert({
    where: { key },
    create: { key, value, updatedById: userId },
    update: { value, updatedById: userId },
  });
  cache.delete(key);
}

export const clearSettingsCache = () => cache.clear();
