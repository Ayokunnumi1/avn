import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';

export const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const hmacHex = (secret: string, data: string, algo: 'sha256' | 'sha512' = 'sha256') =>
  createHmac(algo, secret).update(data).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** URL-safe random token with the given entropy in bytes. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Numeric code with uniform distribution (no modulo bias). */
export function numericCode(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String(randomInt(0, 10));
  return out;
}

/** Human-friendly reference e.g. AVN-REQ-7K3Q9X2M (Crockford-style alphabet, no 0/O/1/I). */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function reference(prefix: string, length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(0, ALPHABET.length)];
  return `${prefix}-${out}`;
}

/** AES-256-GCM field encryption for sensitive values at rest (e.g. payout account numbers, ID numbers). */
export function encryptField(plain: string, keyHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptField(payload: string, keyHex: string): string {
  const [version, iv, tag, data] = payload.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

export const maskTail = (value: string, visible = 4) =>
  value.length <= visible ? value : `${'•'.repeat(Math.max(0, value.length - visible))}${value.slice(-visible)}`;
