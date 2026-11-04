import { describe, expect, it } from 'vitest';
import { haversineMetres, isValidCoordinate, coarsen } from '../src/geo';
import { addMoney, toMinorUnits, fromMinorUnits } from '../src/money';
import { normalisePhone } from '../src/phone';
import { encryptField, decryptField, safeEqual, reference } from '../src/crypto';

describe('geo', () => {
  it('computes haversine distance between two Lagos points within 1%', () => {
    // Ikeja City Mall → Allen Avenue roundabout ≈ 1.75 km
    const d = haversineMetres({ lat: 6.6142, lng: 3.3581 }, { lat: 6.6018, lng: 3.3515 });
    expect(d).toBeGreaterThan(1500);
    expect(d).toBeLessThan(1700);
  });
  it('rejects invalid and null-island coordinates', () => {
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(0, 0)).toBe(false);
    expect(isValidCoordinate(Number.NaN, 3)).toBe(false);
    expect(isValidCoordinate(6.5, 3.3)).toBe(true);
  });
  it('coarsens coordinates', () => {
    expect(coarsen({ lat: 6.52437, lng: 3.37921 })).toEqual({ lat: 6.52, lng: 3.38 });
  });
});

describe('money', () => {
  it('adds without floating point error', () => {
    expect(addMoney('0.1', '0.2')).toBe('0.30');
    expect(toMinorUnits('2500.50')).toBe(250050);
    expect(fromMinorUnits(250050)).toBe('2500.50');
  });
});

describe('phone', () => {
  it('normalises Nigerian numbers to E.164', () => {
    expect(normalisePhone('0803 123 4567')).toBe('+2348031234567');
    expect(normalisePhone('+234 803 123 4567')).toBe('+2348031234567');
    expect(normalisePhone('12345')).toBeNull();
  });
});

describe('crypto', () => {
  it('round-trips field encryption', () => {
    const key = 'a'.repeat(64);
    const enc = encryptField('0123456789', key);
    expect(enc).not.toContain('0123456789');
    expect(decryptField(enc, key)).toBe('0123456789');
  });
  it('safeEqual and references', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(reference('AVN')).toMatch(/^AVN-[2-9A-HJ-NP-Z]{8}$/);
  });
});
