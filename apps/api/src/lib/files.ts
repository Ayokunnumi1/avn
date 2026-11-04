import { createHash } from 'node:crypto';
import multer from 'multer';
import { hmacHex, safeEqual } from '@avn/shared-utils/crypto';
import { extensionFor, sniffMime } from '@avn/storage';
import { deps } from '../container';
import { badRequest } from './errors';

/** In-memory multipart parsing with hard limits; files are validated by magic bytes before storage. */
export const upload = (field: string, maxFiles = 1) => {
  const mb = deps().env.MAX_UPLOAD_MB;
  const m = multer({ storage: multer.memoryStorage(), limits: { fileSize: mb * 1024 * 1024, files: maxFiles, fields: 30 } });
  return maxFiles === 1 ? m.single(field) : m.array(field, maxFiles);
};

export interface StoreFileInput {
  data: Buffer;
  allowed: readonly string[];
  purpose: string;
  ownerUserId?: string | null;
  organisationId?: string | null;
  originalName?: string;
}

export async function storeFile(input: StoreFileInput) {
  const { prisma, storage, scanner } = deps();
  const mime = sniffMime(input.data);
  if (!mime || !input.allowed.includes(mime)) {
    throw badRequest(`Unsupported file type. Allowed: ${input.allowed.join(', ')}`);
  }
  const sha256 = createHash('sha256').update(input.data).digest('hex');
  const scan = await scanner.scan(input.data);
  if (scan === 'INFECTED') throw badRequest('The file failed a security scan');
  const now = new Date();
  const key = `${input.purpose}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${sha256.slice(0, 2)}/${crypto.randomUUID()}.${extensionFor(mime)}`;
  await storage.put(key, input.data, mime);
  return prisma.storedFile.create({
    data: {
      storageKey: key,
      purpose: input.purpose,
      mimeType: mime,
      sizeBytes: input.data.length,
      sha256,
      originalName: input.originalName?.slice(0, 200),
      ownerUserId: input.ownerUserId ?? null,
      organisationId: input.organisationId ?? null,
      scanStatus: scan,
    },
  });
}

/** Short-lived signed link (default 10 minutes). Issued only after an authorisation check. */
export function signedFileUrl(fileId: string, ttlSec = 600): string {
  const { env } = deps();
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = hmacHex(env.STORAGE_SIGNING_SECRET, `${fileId}.${exp}`);
  return `/api/v1/files/${fileId}?exp=${exp}&sig=${sig}`;
}

export function verifyFileSignature(fileId: string, exp: string, sig: string): boolean {
  const { env } = deps();
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Date.now() / 1000) return false;
  return safeEqual(hmacHex(env.STORAGE_SIGNING_SECRET, `${fileId}.${e}`), sig);
}
