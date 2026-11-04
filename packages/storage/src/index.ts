import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

/**
 * Private object storage. Files are never served from a public path; the API streams
 * them only after an authorisation check or a short-lived signed link (spec Part 12).
 */
export interface ObjectStorage {
  readonly driver: string;
  put(key: string, data: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export class LocalDiskStorage implements ObjectStorage {
  readonly driver = 'local';
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(key: string): string {
    if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes('..')) throw new Error('Invalid storage key');
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('Storage key escapes root');
    return full;
  }
  async put(key: string, data: Buffer, _mimeType?: string): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true, mode: 0o700 });
    await writeFile(p, data, { mode: 0o600 });
  }
  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }
  async exists(key: string): Promise<boolean> {
    return stat(this.path(key)).then(
      () => true,
      () => false,
    );
  }
  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

/** Malware scanning integration point. Replace with ClamAV/vendor adapter; results are persisted per file. */
export interface MalwareScanner {
  readonly name: string;
  scan(data: Buffer): Promise<'CLEAN' | 'INFECTED' | 'NOT_SCANNED'>;
}
export class NoopScanner implements MalwareScanner {
  readonly name = 'none';
  async scan(): Promise<'NOT_SCANNED'> {
    return 'NOT_SCANNED';
  }
}

/** Detects the real file type from magic bytes — the client-declared MIME type is never trusted. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  return null;
}

export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const DOCUMENT_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const VIDEO_MIME = ['video/mp4', 'video/webm'] as const;
export const extensionFor = (mime: string) =>
  ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/webm': 'webm' })[mime] ?? 'bin';
