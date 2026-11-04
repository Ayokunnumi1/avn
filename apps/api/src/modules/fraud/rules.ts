import type { FraudSeverity } from '@avn/contracts';
import { haversineMetres, type LatLng } from '@avn/shared-utils/geo';

/**
 * Deterministic, explainable fraud rules (spec §4.4). Each rule returns a signal with a
 * plain-language explanation; high-severity results always route to human review.
 */
export interface Signal {
  rule: string;
  severity: FraudSeverity;
  score: number;
  explanation: string;
  data?: Record<string, unknown>;
}

export interface EvidenceCheckInput {
  serverSha256: string;
  clientSha256?: string;
  compressed: boolean;
  exactDuplicateElsewhere: boolean;
  similarElsewhere: { distance: number } | null;
  capturedAt: Date;
  receivedAt: Date;
  point: LatLng;
  accuracyM: number;
  target: LatLng;
  thresholdM: number;
  maxAccuracyM: number;
}

export function evidenceSignals(i: EvidenceCheckInput): Signal[] {
  const out: Signal[] = [];
  if (i.exactDuplicateElsewhere) out.push({ rule: 'DUPLICATE_IMAGE', severity: 'HIGH', score: 60, explanation: 'This exact image was already submitted for a different verification.' });
  else if (i.similarElsewhere)
    out.push({ rule: 'SIMILAR_IMAGE', severity: 'MEDIUM', score: 30, explanation: `Image is visually near-identical (distance ${i.similarElsewhere.distance}) to evidence from another verification.`, data: i.similarElsewhere });
  if (i.clientSha256 && !i.compressed && i.clientSha256 !== i.serverSha256)
    out.push({ rule: 'HASH_MISMATCH', severity: 'HIGH', score: 40, explanation: 'File hash computed on the device does not match the uploaded file (possible tampering in transit).' });
  const skewMin = (i.receivedAt.getTime() - i.capturedAt.getTime()) / 60_000;
  if (skewMin < -2 || skewMin > 24 * 60)
    out.push({ rule: 'CAPTURE_TIME_SKEW', severity: 'MEDIUM', score: 20, explanation: `Capture time is ${Math.round(skewMin)} minutes from server receipt (offline capture or clock manipulation).`, data: { skewMin } });
  const dist = Math.round(haversineMetres(i.point, i.target));
  if (dist > i.thresholdM * 4)
    out.push({ rule: 'EVIDENCE_FAR_FROM_TARGET', severity: 'MEDIUM', score: 25, explanation: `Photo captured ${dist} m from the pinned property.`, data: { dist } });
  if (i.accuracyM > i.maxAccuracyM * 2) out.push({ rule: 'POOR_GPS_ACCURACY', severity: 'LOW', score: 5, explanation: `GPS accuracy ±${Math.round(i.accuracyM)} m at capture.` });
  return out;
}

export interface ArrivalCheckInput {
  isMocked?: boolean;
  accuracyM: number;
  maxAccuracyM: number;
  arrivalPoint: LatLng;
  arrivalAt: Date;
  lastKnown?: { point: LatLng; at: Date } | null;
}

export function arrivalSignals(i: ArrivalCheckInput): Signal[] {
  const out: Signal[] = [];
  if (i.isMocked) out.push({ rule: 'MOCK_LOCATION', severity: 'HIGH', score: 50, explanation: 'Device reported a mocked/simulated location.' });
  if (i.accuracyM > i.maxAccuracyM) out.push({ rule: 'POOR_GPS_ACCURACY', severity: 'LOW', score: 10, explanation: `Arrival GPS accuracy ±${Math.round(i.accuracyM)} m exceeds ${i.maxAccuracyM} m.` });
  // Only meaningful for jumps beyond GPS noise; a 60 s floor stops jitter reading as "speed".
  const jumpM = i.lastKnown ? haversineMetres(i.lastKnown.point, i.arrivalPoint) : 0;
  if (i.lastKnown && jumpM > 1000) {
    const hours = Math.max((i.arrivalAt.getTime() - i.lastKnown.at.getTime()) / 3600_000, 60 / 3600);
    const kmh = jumpM / 1000 / hours;
    if (kmh > 150) out.push({ rule: 'IMPOSSIBLE_TRAVEL', severity: 'HIGH', score: 45, explanation: `Implied travel speed of ${Math.round(kmh)} km/h since the last location heartbeat.`, data: { kmh } });
    else if (kmh > 60) out.push({ rule: 'FAST_TRAVEL', severity: 'LOW', score: 10, explanation: `Implied travel speed of ${Math.round(kmh)} km/h (vehicle travel).`, data: { kmh } });
  }
  return out;
}

export function submissionSignals(i: { arrivedAt: Date | null; submittedAt: Date }): Signal[] {
  if (!i.arrivedAt) return [];
  const minutes = (i.submittedAt.getTime() - i.arrivedAt.getTime()) / 60_000;
  return minutes < 2 ? [{ rule: 'RAPID_COMPLETION', severity: 'LOW', score: 10, explanation: `Visit completed ${minutes.toFixed(1)} minutes after arrival.` }] : [];
}

export function aggregate(signals: Array<Pick<Signal, 'score' | 'severity'>>): { score: number; highSeverity: boolean } {
  return { score: Math.min(100, signals.reduce((s, x) => s + x.score, 0)), highSeverity: signals.some((s) => s.severity === 'HIGH') };
}

/** 64-bit difference hash (dHash) Hamming distance for near-duplicate detection. */
export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}
