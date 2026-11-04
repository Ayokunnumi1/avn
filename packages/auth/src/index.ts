import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { hmacHex, randomToken, safeEqual } from '@avn/shared-utils/crypto';

interface ScryptParams {
  N: number;
  r: number;
  p: number;
  maxmem: number;
}
const scrypt = (pw: string, salt: Buffer, keylen: number, opts: ScryptParams) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(pw, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

// ─── Passwords: scrypt (N=2^15, r=8, p=1) with per-password salt ─────────────
const SCRYPT: ScryptParams = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    // Do equivalent work so response timing does not reveal whether an account exists.
    await scrypt(password, randomBytes(16), KEYLEN, SCRYPT);
    return false;
  }
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// ─── Opaque tokens (sessions, invitations, password resets) ──────────────────
/** Returns the raw token for the client and the keyed hash to persist. Raw tokens are never stored. */
export function issueToken(secret: string, bytes = 32): { raw: string; hash: string } {
  const raw = randomToken(bytes);
  return { raw, hash: hashToken(secret, raw) };
}
export const hashToken = (secret: string, raw: string) => hmacHex(secret, raw);
export const hashOtp = (secret: string, destination: string, code: string) =>
  hmacHex(secret, `otp:${destination}:${code}`);

// ─── API keys: avn_live_<prefix>.<secret> ───────────────────────────────────
export function generateApiKey(secret: string, env: 'live' | 'test' = 'live') {
  const prefix = `avn_${env}_${randomBytes(6).toString('hex')}`;
  const body = randomToken(32);
  return { key: `${prefix}.${body}`, prefix, secretHash: hashToken(secret, body) };
}
export function parseApiKey(key: string): { prefix: string; body: string } | null {
  const m = /^(avn_(?:live|test)_[a-f0-9]{12})\.([A-Za-z0-9_-]{20,})$/.exec(key.trim());
  return m ? { prefix: m[1]!, body: m[2]! } : null;
}
export const verifyApiKeySecret = (secret: string, body: string, storedHash: string) =>
  safeEqual(hashToken(secret, body), storedHash);

// ─── TOTP (RFC 6238, SHA-1, 30s, 6 digits) for MFA ───────────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str: string): Buffer {
  const clean = str.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export const generateTotpSecret = () => base32Encode(randomBytes(20));

export function totpAt(secretB32: string, timeMs: number, step = 30, digits = 6): string {
  const counter = Math.floor(timeMs / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secretB32)).update(buf).digest();
  const offset = h[h.length - 1]! & 0xf;
  const code =
    ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(code % 10 ** digits).padStart(digits, '0');
}

/** Accepts the current step and ±1 step of clock drift. */
export function verifyTotp(secretB32: string, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((w) => safeEqual(totpAt(secretB32, now + w * 30_000), code));
}
export const totpUri = (secretB32: string, account: string, issuer = 'AVN') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/** Session lifetimes per audience; privileged audiences get shorter sessions. */
export const SESSION_TTL_MS: Record<string, number> = {
  applicant: 30 * 24 * 3600_000,
  verifier: 14 * 24 * 3600_000,
  business: 12 * 3600_000,
  admin: 8 * 3600_000,
  guest: 2 * 3600_000,
};
export const sessionCookieName = (audience: string) => `avn_${audience}_session`;
