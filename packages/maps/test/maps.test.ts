import { describe, expect, it } from 'vitest';
import { decodePolyline6, estimateWalk, ValhallaRouter } from '../src';

describe('routing', () => {
  it('labels straight-line estimates as estimates', () => {
    const r = estimateWalk({ lat: 6.5244, lng: 3.3792 }, { lat: 6.5344, lng: 3.3792 });
    expect(r.source).toBe('estimate');
    expect(r.distanceM).toBeGreaterThan(1400); // 1.11km × 1.3 detour
    expect(r.durationMin).toBeCloseTo(r.distanceM / 80, 0);
  });

  it('falls back to an estimate when Valhalla is unreachable (map provider unavailable)', async () => {
    let fellBack = false;
    const router = new ValhallaRouter('http://127.0.0.1:9', 500, () => (fellBack = true));
    const r = await router.walkingRoute({ lat: 6.52, lng: 3.37 }, { lat: 6.53, lng: 3.38 });
    expect(r.source).toBe('estimate');
    expect(fellBack).toBe(true);
    const m = await router.walkingMatrix([{ lat: 6.52, lng: 3.37 }], { lat: 6.53, lng: 3.38 });
    expect(m[0]!.source).toBe('estimate');
  });

  it('decodes polyline6', () => {
    // Encodes (38.5,-120.2),(40.7,-120.95) at precision 6
    const pts = decodePolyline6('_izlhA~rlgdF_{geC~ywl@');
    expect(pts[0]!.lat).toBeCloseTo(38.5, 4);
    expect(pts[0]!.lng).toBeCloseTo(-120.2, 4);
    expect(pts[1]!.lat).toBeCloseTo(40.7, 4);
  });
});
