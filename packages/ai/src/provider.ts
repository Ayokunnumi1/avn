import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Provider-independent AI interface (spec §4.1). Business modules depend on `AiProvider`
 * only; Anthropic is one implementation and `DisabledAiProvider` keeps the platform
 * fully operational with AI switched off.
 */
export interface AiImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
}
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  images: number;
}
export type AiFailureReason = 'DISABLED' | 'BUDGET_EXCEEDED' | 'PROVIDER_ERROR' | 'INVALID_OUTPUT' | 'REFUSAL' | 'TIMEOUT' | 'RATE_LIMITED';
export type AiResult<T> =
  | { ok: true; data: T; usage: AiUsage; model: string; provider: string; latencyMs: number }
  | { ok: false; reason: AiFailureReason; error: string; usage?: AiUsage; model?: string; provider: string; latencyMs: number };

export interface StructuredRequest<T> {
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  images?: AiImage[];
  maxTokens?: number;
}
export interface TextRequest {
  model: string;
  system: string;
  prompt: string;
  maxTokens?: number;
}

export interface AiProvider {
  readonly name: string;
  readonly enabled: boolean;
  generateText(req: TextRequest): Promise<AiResult<string>>;
  /** Structured JSON generation; output is always validated with the supplied Zod schema. */
  generateStructured<T>(req: StructuredRequest<T>): Promise<AiResult<T>>;
  /** Image analysis = structured generation with image inputs. */
  analyzeImage<T>(req: StructuredRequest<T> & { images: AiImage[] }): Promise<AiResult<T>>;
  /** OCR = structured extraction of visible text from images. */
  ocr(req: { model: string; images: AiImage[]; hint?: string }): Promise<AiResult<OcrOutput>>;
}

export const OcrSchema = z.object({
  lines: z.array(z.string()).describe('Every legible line of text, top to bottom'),
  numbers: z.array(z.string()).describe('House/plot numbers or other numerals that appear to identify a property'),
  legible: z.boolean(),
});
export type OcrOutput = z.infer<typeof OcrSchema>;

export class DisabledAiProvider implements AiProvider {
  readonly name = 'disabled';
  readonly enabled = false;
  private fail<T>(): Promise<AiResult<T>> {
    return Promise.resolve({ ok: false, reason: 'DISABLED', error: 'AI is disabled', provider: this.name, latencyMs: 0 });
  }
  generateText(_req: TextRequest) {
    return this.fail<string>();
  }
  generateStructured<T>(_req: StructuredRequest<T>) {
    return this.fail<T>();
  }
  analyzeImage<T>(_req: StructuredRequest<T> & { images: AiImage[] }) {
    return this.fail<T>();
  }
  ocr(_req: { model: string; images: AiImage[]; hint?: string }) {
    return this.fail<OcrOutput>();
  }
}

/** Public list prices (USD per million tokens) used for spend tracking and budgets. */
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-fable-5-1': { input: 10, output: 50 },
};
export function estimateCostUsd(model: string, usage: AiUsage): number {
  const p = PRICING[model] ?? PRICING['claude-opus-5-5']!;
  return (usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000;
}

export function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const js = zodToJsonSchema(schema, { $refStrategy: 'none', target: 'jsonSchema7' }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

export class AnthropicAiProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly enabled = true;
  private readonly client: Anthropic;

  constructor(apiKey: string, opts: { timeoutMs?: number; maxRetries?: number } = {}) {
    // SDK retries 408/409/429/5xx and connection errors; keep retries low so the platform
    // degrades quickly to deterministic fallbacks instead of blocking user workflows.
    this.client = new Anthropic({ apiKey, timeout: opts.timeoutMs ?? 20000, maxRetries: opts.maxRetries ?? 1 });
  }

  private async run(
    model: string,
    system: string,
    content: Anthropic.ContentBlockParam[],
    maxTokens: number,
    jsonSchema?: Record<string, unknown>,
  ): Promise<AiResult<string>> {
    const started = Date.now();
    try {
      const params = {
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user' as const, content }],
        output_config: {
          // Classification/extraction workloads: low effort keeps latency and spend down.
          effort: 'low',
          ...(jsonSchema ? { format: { type: 'json_schema', schema: jsonSchema } } : {}),
        },
        // Server-side refusal fallback routes declined requests to an appropriate model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      };
      const response = (await this.client.beta.messages.create(
        params as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
      )) as Anthropic.Beta.Messages.BetaMessage;
      const usage: AiUsage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        images: content.filter((c) => c.type === 'image').length,
      };
      const latencyMs = Date.now() - started;
      if (response.stop_reason === 'refusal') {
        return { ok: false, reason: 'REFUSAL', error: 'Model declined the request', usage, model: response.model, provider: this.name, latencyMs };
      }
      if (response.stop_reason === 'max_tokens') {
        return { ok: false, reason: 'INVALID_OUTPUT', error: 'Output truncated at max_tokens', usage, model: response.model, provider: this.name, latencyMs };
      }
      const text = response.content
        .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return { ok: true, data: text, usage, model: response.model, provider: this.name, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - started;
      if (err instanceof Anthropic.RateLimitError) return { ok: false, reason: 'RATE_LIMITED', error: err.message, provider: this.name, latencyMs };
      if (err instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, reason: 'TIMEOUT', error: err.message, provider: this.name, latencyMs };
      if (err instanceof Anthropic.APIError) return { ok: false, reason: 'PROVIDER_ERROR', error: `${err.status ?? ''} ${err.message}`, provider: this.name, latencyMs };
      return { ok: false, reason: 'PROVIDER_ERROR', error: err instanceof Error ? err.message : 'Unknown AI error', provider: this.name, latencyMs };
    }
  }

  generateText(req: TextRequest): Promise<AiResult<string>> {
    return this.run(req.model, req.system, [{ type: 'text', text: req.prompt }], req.maxTokens ?? 1024);
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<AiResult<T>> {
    const content: Anthropic.ContentBlockParam[] = [
      ...(req.images ?? []).map((img) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 } })),
      { type: 'text', text: req.prompt },
    ];
    const res = await this.run(req.model, req.system, content, req.maxTokens ?? 1024, toJsonSchema(req.schema));
    if (!res.ok) return res;
    let json: unknown;
    try {
      json = JSON.parse(res.data);
    } catch {
      return { ok: false, reason: 'INVALID_OUTPUT', error: 'Response was not valid JSON', usage: res.usage, model: res.model, provider: this.name, latencyMs: res.latencyMs };
    }
    const parsed = req.schema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, reason: 'INVALID_OUTPUT', error: parsed.error.message.slice(0, 500), usage: res.usage, model: res.model, provider: this.name, latencyMs: res.latencyMs };
    }
    return { ...res, data: parsed.data };
  }

  analyzeImage<T>(req: StructuredRequest<T> & { images: AiImage[] }): Promise<AiResult<T>> {
    return this.generateStructured(req);
  }

  ocr(req: { model: string; images: AiImage[]; hint?: string }): Promise<AiResult<OcrOutput>> {
    return this.generateStructured({
      model: req.model,
      images: req.images,
      schema: OcrSchema,
      system: 'You transcribe text visible in images exactly as written. Never guess illegible text; omit it.',
      prompt: `Transcribe all legible text in the image(s).${req.hint ? ` Context: ${req.hint}` : ''}`,
      maxTokens: 800,
    });
  }
}
