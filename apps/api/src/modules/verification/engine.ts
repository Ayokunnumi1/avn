import type { ChecklistInput, EvidenceCategory, FinalOutcome, FindingKey, FindingValue, PolicyRules } from '@avn/contracts';

/**
 * Deterministic, versioned verification rules (spec Part 6).
 *
 * Principles encoded here:
 *  - Individual findings are kept separate from the final result.
 *  - A property existing does not establish residency.
 *  - Applicant absence does not establish that an address is false.
 *  - An uploaded document never independently establishes the physical address.
 *  - A visit confirmation code alone does not establish residence.
 *  - AI output is NOT an input. Only field observations, GPS records, evidence and
 *    deterministic fraud signals are considered.
 */
export const RULES_VERSION = 'avn-rules@1.0.0';

export interface EngineInput {
  checklist: ChecklistInput;
  policy: PolicyRules;
  arrival: {
    distanceM: number | null;
    thresholdM: number;
    withinThreshold: boolean | null;
    accuracyM: number | null;
    exception: 'NONE' | 'POOR_GPS' | 'PROPERTY_INACCESSIBLE' | 'ADDRESS_NOT_FOUND';
  };
  evidence: { categoriesPresent: EvidenceCategory[]; count: number; duplicates: number };
  applicantCodeConfirmed: boolean;
  supportingDocuments: number;
  fraud: { score: number; highSeverity: boolean };
}

export interface Finding {
  key: FindingKey;
  value: FindingValue;
  basis: string[];
}
export interface EngineResult {
  rulesVersion: string;
  findings: Finding[];
  outcome: FinalOutcome;
  reasons: string[];
  reviewTriggers: string[];
}

export function evaluate(input: EngineInput): EngineResult {
  const { checklist: c, policy, arrival, evidence } = input;
  const has = (cat: EvidenceCategory) => evidence.categoriesPresent.includes(cat);
  const missing = policy.requiredEvidence.filter((cat) => !has(cat));
  if (policy.mandatoryVideo && !has('VIDEO_WALKTHROUGH')) missing.push('VIDEO_WALKTHROUGH');

  // ── Building existence ───────────────────────────────────────────────────
  const building: Finding = { key: 'BUILDING_EXISTENCE', value: 'UNABLE_TO_DETERMINE', basis: [] };
  if (c.buildingExists === 'YES' && has('BUILDING_EXTERIOR')) {
    building.value = 'CONFIRMED';
    building.basis.push('Verifier observed the building and captured an exterior photograph');
  } else if (c.buildingExists === 'YES') {
    building.basis.push('Verifier reported a building but no exterior photograph was captured');
  } else if (c.buildingExists === 'NO') {
    building.value = 'CONTRADICTED';
    building.basis.push('Verifier reported no building at the submitted location');
  } else building.basis.push('Verifier could not determine whether the building exists');
  if (c.buildingType) building.basis.push(`Building type: ${c.buildingType.replace(/_/g, ' ').toLowerCase()}`);

  // ── Address match ────────────────────────────────────────────────────────
  const address: Finding = { key: 'ADDRESS_MATCH', value: 'UNABLE_TO_DETERMINE', basis: [] };
  const locationOk = arrival.withinThreshold === true;
  if (arrival.distanceM != null) address.basis.push(`Arrival recorded ${arrival.distanceM} m from the pinned location (threshold ${arrival.thresholdM} m)`);
  if (c.addressMatchesDescription === 'NO') {
    address.value = 'CONTRADICTED';
    address.basis.push('Physical address does not match the submitted description');
  } else if (c.addressMatchesDescription === 'PARTIAL') {
    address.value = 'NOT_CONFIRMED';
    address.basis.push('Physical address only partially matches the submitted description');
  } else if (c.addressMatchesDescription === 'YES' && locationOk) {
    address.value = 'CONFIRMED';
    address.basis.push('Physical address matches the description at the pinned location');
    if (c.houseNumberVisible) address.basis.push('House number visible on site');
  } else if (c.addressMatchesDescription === 'YES') {
    address.basis.push('Description matched but arrival location could not be validated within the threshold');
  } else address.basis.push('Verifier could not determine whether the address matches');

  // ── Occupancy ────────────────────────────────────────────────────────────
  const occupancy: Finding = {
    key: 'OCCUPANCY',
    value: c.occupancySigns === 'OCCUPIED' ? 'CONFIRMED' : c.occupancySigns === 'APPEARS_VACANT' ? 'NOT_CONFIRMED' : 'UNABLE_TO_DETERMINE',
    basis: [c.occupancySigns === 'OCCUPIED' ? 'Signs of occupation observed' : c.occupancySigns === 'APPEARS_VACANT' ? 'Property appeared vacant' : 'Occupancy could not be determined'],
  };

  // ── Applicant presence ───────────────────────────────────────────────────
  const presence: Finding = {
    key: 'APPLICANT_PRESENCE',
    value: c.applicantAvailable === 'YES' ? 'CONFIRMED' : c.applicantAvailable === 'NO' ? 'NOT_CONFIRMED' : 'UNABLE_TO_DETERMINE',
    basis: [c.applicantAvailable === 'YES' ? 'Applicant was personally available' : 'Applicant was not personally available during the visit'],
  };
  if (!policy.applicantPresenceRequired) presence.basis.push('Applicant presence not required by policy');

  // ── Residency confirmation ───────────────────────────────────────────────
  const residency: Finding = { key: 'RESIDENCY_CONFIRMATION', value: 'NOT_CONFIRMED', basis: [] };
  if (c.applicantAvailable === 'YES' && c.applicantConfirmedResidence === 'YES') {
    residency.value = 'CONFIRMED';
    residency.basis.push('Applicant confirmed residence in person');
  } else if (c.occupantConfirmedResidence === 'YES') {
    residency.value = 'CONFIRMED';
    residency.basis.push('Another occupant confirmed the applicant resides here');
  } else if (c.contactRefused === 'YES') {
    residency.value = 'UNABLE_TO_DETERMINE';
    residency.basis.push('Contact was refused at the property');
  } else if (c.anyoneAvailable === 'NO') {
    residency.value = 'UNABLE_TO_DETERMINE';
    residency.basis.push('Nobody was available to confirm residence');
  } else residency.basis.push('Residence was not confirmed by anyone at the property');
  if (input.applicantCodeConfirmed) residency.basis.push('Applicant confirmed participation with a one-time code (does not by itself establish residence)');
  if (input.supportingDocuments > 0) residency.basis.push(`${input.supportingDocuments} supporting document(s) on file (not independent proof of the physical address)`);
  if (!policy.residencyConfirmationRequired) residency.basis.push('Residency confirmation not required by policy');

  // ── Contactability ───────────────────────────────────────────────────────
  const contact: Finding = { key: 'CONTACTABILITY', value: 'UNABLE_TO_DETERMINE', basis: [] };
  if (c.applicantAvailable === 'YES' || input.applicantCodeConfirmed) {
    contact.value = 'CONFIRMED';
    contact.basis.push(c.applicantAvailable === 'YES' ? 'Applicant met the verifier' : 'Applicant responded to the visit confirmation code');
  } else if (c.contactRefused === 'YES') {
    contact.value = 'NOT_CONFIRMED';
    contact.basis.push('Contact refused');
  } else contact.basis.push('Applicant could not be reached during the visit');

  // ── Evidence integrity ───────────────────────────────────────────────────
  const integrity: Finding = { key: 'EVIDENCE_INTEGRITY', value: 'CONFIRMED', basis: [`${evidence.count} item(s) of camera evidence captured`] };
  if (evidence.duplicates > 0 || input.fraud.highSeverity) {
    integrity.value = 'CONTRADICTED';
    integrity.basis.push(evidence.duplicates > 0 ? `${evidence.duplicates} item(s) duplicate earlier evidence` : 'High-severity integrity signal raised');
  } else if (missing.length > 0) {
    integrity.value = 'NOT_CONFIRMED';
    integrity.basis.push(`Missing required evidence: ${missing.join(', ').toLowerCase().replace(/_/g, ' ')}`);
  } else integrity.basis.push('All required evidence categories present');

  const findings = [building, address, occupancy, presence, residency, contact, integrity];

  // ── Final outcome ────────────────────────────────────────────────────────
  const reasons: string[] = [];
  const reviewTriggers: string[] = [];
  if (input.fraud.highSeverity) reviewTriggers.push('High-severity fraud signal');
  if (input.fraud.score >= policy.manualReviewRiskThreshold) reviewTriggers.push(`Risk score ${input.fraud.score} ≥ policy threshold ${policy.manualReviewRiskThreshold}`);
  if (integrity.value === 'CONTRADICTED') reviewTriggers.push('Evidence integrity contradicted');
  if (arrival.exception === 'POOR_GPS') reviewTriggers.push('Verifier reported poor GPS accuracy');
  if (arrival.withinThreshold === false && arrival.exception === 'NONE') reviewTriggers.push('Arrival outside the configured threshold');
  if (address.value === 'NOT_CONFIRMED') reviewTriggers.push('Partial address match');

  let outcome: FinalOutcome;
  if (reviewTriggers.length > 0) {
    outcome = 'MANUAL_REVIEW';
    reasons.push(...reviewTriggers);
  } else if (building.value === 'CONTRADICTED' || address.value === 'CONTRADICTED' || arrival.exception === 'ADDRESS_NOT_FOUND') {
    outcome = 'NOT_VERIFIED';
    reasons.push('Field observation contradicts the submitted address');
  } else if (integrity.value === 'NOT_CONFIRMED') {
    outcome = 'INCONCLUSIVE';
    reasons.push('Required evidence is incomplete');
  } else if (building.value === 'CONFIRMED' && address.value === 'CONFIRMED') {
    const residencyOk = !policy.residencyConfirmationRequired || residency.value === 'CONFIRMED';
    const presenceOk = !policy.applicantPresenceRequired || presence.value === 'CONFIRMED';
    if (residencyOk && presenceOk) {
      outcome = 'VERIFIED';
      reasons.push('Building and address confirmed; policy residency/presence requirements met');
    } else {
      outcome = 'PARTIALLY_VERIFIED';
      if (!residencyOk) reasons.push('Building and address confirmed, but residency was not confirmed');
      if (!presenceOk) reasons.push('Applicant presence required by policy but applicant was not available');
    }
  } else {
    outcome = 'INCONCLUSIVE';
    reasons.push(arrival.exception === 'PROPERTY_INACCESSIBLE' ? 'Property was inaccessible' : 'Building or address could not be determined');
  }
  return { rulesVersion: RULES_VERSION, findings, outcome, reasons, reviewTriggers };
}

export const FINDING_LABELS: Record<FindingKey, string> = {
  BUILDING_EXISTENCE: 'Building existence',
  ADDRESS_MATCH: 'Address match',
  OCCUPANCY: 'Occupancy',
  APPLICANT_PRESENCE: 'Applicant presence',
  RESIDENCY_CONFIRMATION: 'Residency confirmation',
  CONTACTABILITY: 'Contactability',
  EVIDENCE_INTEGRITY: 'Evidence integrity',
};
export const VALUE_LABELS: Record<FindingValue, string> = {
  CONFIRMED: 'Confirmed',
  NOT_CONFIRMED: 'Not confirmed',
  CONTRADICTED: 'Contradicted',
  UNABLE_TO_DETERMINE: 'Unable to determine',
  NOT_REQUIRED: 'Not required',
};
export const OUTCOME_LABELS: Record<FinalOutcome, string> = {
  VERIFIED: 'Verified',
  PARTIALLY_VERIFIED: 'Partially verified',
  NOT_VERIFIED: 'Not verified',
  INCONCLUSIVE: 'Inconclusive',
  MANUAL_REVIEW: 'Manual review',
};
