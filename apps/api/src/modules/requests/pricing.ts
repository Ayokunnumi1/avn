import { DEFAULT_POLICY_RULES, policyRulesSchema, type PolicyRules, type VerificationLevel } from '@avn/contracts';
import type { Tx } from '@avn/database';
import { Decimal } from '@avn/shared-utils/money';
import { AppError, badRequest } from '../../lib/errors';
import { getPlatformConfig } from '../../lib/settings';

/** Price, reward and SLA come from configurable PricingPlan rows — never hardcoded per country. */
export async function quote(tx: Tx, countryCode: string, level: VerificationLevel, audience: 'INDIVIDUAL' | 'INSTITUTION', orgId?: string) {
  const plan = await tx.pricingPlan.findUnique({ where: { countryCode_level_audience: { countryCode, level, audience } } });
  if (!plan || !plan.active) throw new AppError(422, 'PRICING_UNAVAILABLE', `Verification level ${level} is not available in ${countryCode}`);
  const country = await tx.country.findUnique({ where: { code: countryCode } });
  if (!country?.active) throw new AppError(422, 'COUNTRY_UNAVAILABLE', `Service is not yet available in ${countryCode}`);
  let price = new Decimal(plan.price.toString());
  if (orgId && plan.bulkThreshold > 0 && plan.bulkPrice) {
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const count = await tx.verificationRequest.count({ where: { organisationId: orgId, createdAt: { gte: monthStart } } });
    if (count >= plan.bulkThreshold) price = new Decimal(plan.bulkPrice.toString());
  }
  const cfg = await getPlatformConfig();
  const reward = plan.verifierReward ? new Decimal(plan.verifierReward.toString()) : price.times(cfg.verifierRewardShare);
  return { price: price.toFixed(2), reward: reward.toFixed(2), currency: country.currency, slaHours: plan.slaHours, timezone: country.timezone };
}

/** Resolves the policy version to freeze onto a new request (versioned; later edits never alter it). */
export async function resolvePolicy(tx: Tx, orgId: string | null, policyId?: string): Promise<{ versionId: string | null; rules: PolicyRules; name: string }> {
  const policy = policyId
    ? await tx.verificationPolicy.findFirst({ where: { id: policyId, archived: false, OR: [{ organisationId: orgId }, { organisationId: null }] } })
    : ((orgId ? await tx.verificationPolicy.findFirst({ where: { organisationId: orgId, isDefault: true, archived: false } }) : null) ??
      (await tx.verificationPolicy.findFirst({ where: { organisationId: null, isDefault: true, archived: false } })));
  if (policyId && !policy) throw badRequest('Unknown verification policy');
  if (!policy) return { versionId: null, rules: DEFAULT_POLICY_RULES, name: 'Platform default' };
  const version = await tx.verificationPolicyVersion.findUnique({ where: { policyId_version: { policyId: policy.id, version: policy.currentVersion } } });
  if (!version) return { versionId: null, rules: DEFAULT_POLICY_RULES, name: policy.name };
  return { versionId: version.id, rules: policyRulesSchema.parse(version.rules), name: `${policy.name} v${version.version}` };
}
