/** Pure geographic helpers. No I/O, safe for browser and server. */
export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function haversineMetres(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0) // "null island" is almost always a device/GPS failure
  );
}

/** Rounds coordinates to ~1.1km so a general area can be shown before an assignment is accepted. */
export function coarsen(point: LatLng, decimals = 2): LatLng {
  const f = 10 ** decimals;
  return { lat: Math.round(point.lat * f) / f, lng: Math.round(point.lng * f) / f };
}

/** Average adult walking speed used only for estimates when no routing engine is reachable. */
export const WALKING_SPEED_M_PER_MIN = 80;
