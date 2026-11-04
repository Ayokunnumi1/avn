import { haversineMetres, type LatLng } from '@avn/shared-utils/geo';

/**
 * Arrival validation (spec B8). Poor GPS or an inaccessible property never auto-rejects a
 * visit; it is recorded and routed to review by the verification engine.
 */
export interface ArrivalResult {
  distanceM: number;
  thresholdM: number;
  withinThreshold: boolean;
  /** Within threshold once GPS uncertainty is considered (used to explain, not to pass). */
  withinThresholdConsideringAccuracy: boolean;
  accuracyAcceptable: boolean;
  status: 'ARRIVED' | 'OUTSIDE_THRESHOLD' | 'POOR_ACCURACY';
}

export function validateArrival(target: LatLng, point: LatLng, accuracyM: number, thresholdM: number, maxAccuracyM: number): ArrivalResult {
  const distanceM = Math.round(haversineMetres(target, point));
  const withinThreshold = distanceM <= thresholdM;
  const accuracyAcceptable = accuracyM <= maxAccuracyM;
  return {
    distanceM,
    thresholdM,
    withinThreshold,
    withinThresholdConsideringAccuracy: distanceM - accuracyM <= thresholdM,
    accuracyAcceptable,
    status: !accuracyAcceptable ? 'POOR_ACCURACY' : withinThreshold ? 'ARRIVED' : 'OUTSIDE_THRESHOLD',
  };
}
