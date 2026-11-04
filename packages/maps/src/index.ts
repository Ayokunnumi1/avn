import { haversineMetres, WALKING_SPEED_M_PER_MIN, type LatLng } from '@avn/shared-utils/geo';

/**
 * Location services behind adapters (spec Part 5). Routing uses a pedestrian engine
 * (Valhalla, `costing: pedestrian`). When the engine is unreachable we fall back to a
 * clearly labelled straight-line ESTIMATE — the `source` field is persisted with every
 * assignment so estimates are never presented as real routes.
 */
export type RouteSource = 'valhalla' | 'estimate';
export interface WalkingRoute {
  distanceM: number;
  durationMin: number;
  source: RouteSource;
  shape?: LatLng[];
}
export interface Router {
  readonly name: string;
  walkingRoute(from: LatLng, to: LatLng, opts?: { withShape?: boolean }): Promise<WalkingRoute>;
  /** Walking time from many origins to one destination (one engine call when supported). */
  walkingMatrix(origins: LatLng[], destination: LatLng): Promise<WalkingRoute[]>;
}

/** Straight-line distance × detour factor at average walking speed. Always labelled `estimate`. */
export function estimateWalk(from: LatLng, to: LatLng): WalkingRoute {
  const distanceM = Math.round(haversineMetres(from, to) * 1.3);
  return { distanceM, durationMin: Math.round((distanceM / WALKING_SPEED_M_PER_MIN) * 10) / 10, source: 'estimate' };
}

export class EstimateRouter implements Router {
  readonly name = 'estimate';
  async walkingRoute(from: LatLng, to: LatLng): Promise<WalkingRoute> {
    return estimateWalk(from, to);
  }
  async walkingMatrix(origins: LatLng[], destination: LatLng): Promise<WalkingRoute[]> {
    return origins.map((o) => estimateWalk(o, destination));
  }
}

/** Decodes Valhalla's polyline6 shape encoding. */
export function decodePolyline6(str: string): LatLng[] {
  const out: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0;
      let shift = 0;
      let b: number;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && index < str.length + 1);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lng += delta;
    }
    out.push({ lat: lat / 1e6, lng: lng / 1e6 });
  }
  return out;
}

export class ValhallaRouter implements Router {
  readonly name = 'valhalla';
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 6000,
    private readonly onFallback?: (err: unknown) => void,
  ) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'AVN-Verification-Platform/0.1' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Valhalla HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async walkingRoute(from: LatLng, to: LatLng, opts?: { withShape?: boolean }): Promise<WalkingRoute> {
    try {
      const data = await this.post<{ trip: { summary: { length: number; time: number }; legs: Array<{ shape: string }> } }>('/route', {
        locations: [
          { lat: from.lat, lon: from.lng },
          { lat: to.lat, lon: to.lng },
        ],
        costing: 'pedestrian',
        directions_options: { units: 'kilometers' },
        directions_type: 'none',
      });
      return {
        distanceM: Math.round(data.trip.summary.length * 1000),
        durationMin: Math.round((data.trip.summary.time / 60) * 10) / 10,
        source: 'valhalla',
        shape: opts?.withShape && data.trip.legs[0] ? decodePolyline6(data.trip.legs[0].shape) : undefined,
      };
    } catch (err) {
      this.onFallback?.(err);
      return estimateWalk(from, to);
    }
  }

  async walkingMatrix(origins: LatLng[], destination: LatLng): Promise<WalkingRoute[]> {
    if (origins.length === 0) return [];
    try {
      const data = await this.post<{ sources_to_targets: Array<Array<{ distance: number | null; time: number | null }>> }>(
        '/sources_to_targets',
        {
          sources: origins.map((o) => ({ lat: o.lat, lon: o.lng })),
          targets: [{ lat: destination.lat, lon: destination.lng }],
          costing: 'pedestrian',
          units: 'kilometers',
        },
      );
      return origins.map((o, i) => {
        const cell = data.sources_to_targets[i]?.[0];
        if (!cell || cell.time == null || cell.distance == null) return estimateWalk(o, destination);
        return { distanceM: Math.round(cell.distance * 1000), durationMin: Math.round((cell.time / 60) * 10) / 10, source: 'valhalla' as const };
      });
    } catch (err) {
      this.onFallback?.(err);
      return origins.map((o) => estimateWalk(o, destination));
    }
  }
}

// ─── Geocoding ───────────────────────────────────────────────────────────────
export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
  components: { state?: string; city?: string; lga?: string; district?: string; street?: string; houseNumber?: string; countryCode?: string };
}
export interface Geocoder {
  readonly name: string;
  search(query: string, countryCode: string): Promise<GeocodeResult[]>;
  reverse(point: LatLng): Promise<GeocodeResult | null>;
}

export class DisabledGeocoder implements Geocoder {
  readonly name = 'disabled';
  async search(): Promise<GeocodeResult[]> {
    return [];
  }
  async reverse(): Promise<GeocodeResult | null> {
    return null;
  }
}

interface NominatimItem {
  display_name: string;
  lat: string;
  lon: string;
  address?: Record<string, string>;
}

/** OpenStreetMap Nominatim. Results are cached and calls are throttled to respect the usage policy. */
export class NominatimGeocoder implements Geocoder {
  readonly name = 'nominatim';
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  private lastCall = 0;
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 6000,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.value as T;
    const wait = 1000 - (Date.now() - this.lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCall = Date.now();
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      headers: { 'User-Agent': 'AVN-Verification-Platform/0.1', 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const value = (await res.json()) as T;
    if (this.cache.size > 2000) this.cache.clear();
    this.cache.set(path, { at: Date.now(), value });
    return value;
  }

  private map(i: NominatimItem): GeocodeResult {
    const a = i.address ?? {};
    return {
      label: i.display_name,
      lat: Number(i.lat),
      lng: Number(i.lon),
      components: {
        state: a.state,
        city: a.city ?? a.town ?? a.village ?? a.county,
        lga: a.county ?? a.city_district,
        district: a.suburb ?? a.neighbourhood ?? a.quarter,
        street: a.road,
        houseNumber: a.house_number,
        countryCode: a.country_code?.toUpperCase(),
      },
    };
  }

  async search(query: string, countryCode: string): Promise<GeocodeResult[]> {
    const q = encodeURIComponent(query.slice(0, 200));
    const items = await this.get<NominatimItem[]>(`/search?q=${q}&format=jsonv2&addressdetails=1&limit=6&countrycodes=${countryCode.toLowerCase()}`);
    return items.map((i) => this.map(i));
  }

  async reverse(point: LatLng): Promise<GeocodeResult | null> {
    const item = await this.get<NominatimItem & { error?: string }>(`/reverse?lat=${point.lat}&lon=${point.lng}&format=jsonv2&addressdetails=1`);
    return item.error ? null : this.map(item);
  }
}

export type { LatLng };
