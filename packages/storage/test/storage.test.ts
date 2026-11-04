import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalDiskStorage, sniffMime } from '../src';

describe('local storage', () => {
  it('stores and retrieves files and blocks path traversal', async () => {
    const s = new LocalDiskStorage(await mkdtemp(join(tmpdir(), 'avn-')));
    await s.put('evidence/a/b.jpg', Buffer.from('hello'), 'image/jpeg');
    expect((await s.get('evidence/a/b.jpg')).toString()).toBe('hello');
    await expect(s.put('../escape.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow();
    await expect(s.get('/etc/passwd')).rejects.toThrow();
  });
});

describe('MIME sniffing', () => {
  it('detects real types regardless of declared type', () => {
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('%PDF-1.7 rest of file'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(sniffMime(Buffer.from('MZ\x90\x00 executable bytes'))).toBeNull();
  });
});
