import { describe, expect, it } from 'vitest';
import {
  AnthropicAiProvider,
  DisabledAiProvider,
  EvidenceAssessmentSchema,
  classifyQuestionRules,
  estimateCostUsd,
  parseAddressRules,
  summaryIntroducesNewNumbers,
  toJsonSchema,
} from '../src';

describe('AI provider resilience', () => {
  it('disabled provider fails closed without throwing', async () => {
    const r = await new DisabledAiProvider().generateText({ model: 'x', system: 's', prompt: 'p' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('DISABLED');
  });

  it('unreachable provider returns a typed failure instead of throwing (AI provider unavailable)', async () => {
    const p = new AnthropicAiProvider('sk-invalid', { timeoutMs: 1500, maxRetries: 0 });
    // Point the SDK at a closed port to simulate an outage.
    (p as unknown as { client: { baseURL: string } }).client.baseURL = 'http://127.0.0.1:9';
    const r = await p.generateText({ model: 'claude-opus-5-5', system: 's', prompt: 'p' });
    expect(r.ok).toBe(false);
  });

  it('produces strict JSON schemas for structured output', () => {
    const js = toJsonSchema(EvidenceAssessmentSchema) as { additionalProperties?: boolean; required?: string[] };
    expect(js.additionalProperties).toBe(false);
    expect(js.required).toContain('clarity');
  });

  it('estimates spend from token usage', () => {
    expect(estimateCostUsd('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 0, images: 0 })).toBe(4);
  });
});

describe('deterministic fallbacks', () => {
  it('parses addresses without inventing components', () => {
    const r = parseAddressRules('12B Adeola Odeku Street, Victoria Island, Lagos', ['Lagos', 'FCT']);
    expect(r.components.houseNumber).toBe('12B');
    expect(r.components.state).toBe('Lagos');
    const missing = parseAddressRules('Adeola Odeku Street', ['Lagos']);
    expect(missing.missing).toEqual(expect.arrayContaining(['houseNumber', 'state']));
  });

  it('classifies institution questions into safe intents', () => {
    expect(classifyQuestionRules('Show all requests still waiting for agents.').intent).toBe('WAITING_FOR_AGENTS');
    expect(classifyQuestionRules('How many applicants were unavailable this month?')).toMatchObject({ intent: 'APPLICANT_UNAVAILABLE_COUNT', period: 'THIS_MONTH' });
    expect(classifyQuestionRules('What percentage of addresses required manual review?').intent).toBe('MANUAL_REVIEW_RATE');
    expect(classifyQuestionRules('Which locations have the highest failure rate?').intent).toBe('FAILURE_RATE_BY_LOCATION');
    expect(classifyQuestionRules('Show our monthly verification expenditure.').intent).toBe('MONTHLY_EXPENDITURE');
    expect(classifyQuestionRules('DROP TABLE users;').intent).toBe('UNSUPPORTED');
  });

  it('detects AI summaries that introduce facts (numbers) absent from evidence', () => {
    const src = JSON.stringify({ distanceM: 18, house: '12B' });
    expect(summaryIntroducesNewNumbers('The verifier was 18 metres away.', src)).toBe(false);
    expect(summaryIntroducesNewNumbers('Three occupants (3) confirmed residence.', src)).toBe(true);
  });
});
