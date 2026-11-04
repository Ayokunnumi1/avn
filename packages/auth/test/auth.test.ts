import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  totpAt,
  verifyTotp,
  base32Decode,
  base32Encode,
  generateApiKey,
  parseApiKey,
  verifyApiKeySecret,
  issueToken,
  hashToken,
} from '../src';

describe('passwords', () => {
  it('hashes with a unique salt and verifies', async () => {
    const h1 = await hashPassword('Correct-Horse-9');
    const h2 = await hashPassword('Correct-Horse-9');
    expect(h1).not.toBe(h2);
    expect(await verifyPassword('Correct-Horse-9', h1)).toBe(true);
    expect(await verifyPassword('wrong', h1)).toBe(false);
    expect(await verifyPassword('x', null)).toBe(false);
  });
});

describe('TOTP (RFC 6238 Appendix B vectors)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('matches the RFC vectors', () => {
    expect(totpAt(secret, 59_000, 30, 8)).toBe('94287082');
    expect(totpAt(secret, 1111111109_000, 30, 8)).toBe('07081804');
    expect(totpAt(secret, 2000000000_000, 30, 8)).toBe('69279037');
  });
  it('verifies within ±1 step of drift and rejects older codes', () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totpAt(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now - 120_000), now)).toBe(false);
  });
  it('round-trips base32', () => {
    expect(base32Decode(base32Encode(Buffer.from('hello world'))).toString()).toBe('hello world');
  });
});

describe('API keys & tokens', () => {
  const secret = 's'.repeat(40);
  it('generates parseable keys whose secret is only stored hashed', () => {
    const { key, prefix, secretHash } = generateApiKey(secret);
    const parsed = parseApiKey(key)!;
    expect(parsed.prefix).toBe(prefix);
    expect(secretHash).not.toContain(parsed.body);
    expect(verifyApiKeySecret(secret, parsed.body, secretHash)).toBe(true);
    expect(verifyApiKeySecret(secret, parsed.body + 'x', secretHash)).toBe(false);
    expect(parseApiKey('garbage')).toBeNull();
  });
  it('issues opaque tokens verifiable by hash', () => {
    const t = issueToken(secret);
    expect(hashToken(secret, t.raw)).toBe(t.hash);
  });
});
