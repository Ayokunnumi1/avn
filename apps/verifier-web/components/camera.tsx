'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button } from '@avn/ui';

/**
 * In-app camera capture (spec B9). Uses a live getUserMedia viewfinder so primary evidence
 * is always a fresh capture — never a gallery pick. The original frame is hashed (SHA-256)
 * before a low-bandwidth JPEG is produced, so integrity is preserved across compression.
 */
export interface Capture {
  blob: Blob;
  originalSha256: string;
  uploadSha256: string;
  compressed: boolean;
  capturedAt: string;
  width: number;
  height: number;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Capture failed'))), 'image/jpeg', quality));
}

export function CameraCapture({ onCapture, label = 'Capture photo' }: { onCapture: (c: Capture) => void; label?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
      })
      .catch(() => setError('Camera access was denied or is unavailable. Allow camera access for this app.'));
    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };
  }, [open]);

  async function shoot() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    setBusy(true);
    try {
      const full = document.createElement('canvas');
      full.width = v.videoWidth;
      full.height = v.videoHeight;
      full.getContext('2d')!.drawImage(v, 0, 0);
      const original = await toBlob(full, 0.95);
      const originalSha256 = await sha256Hex(original);
      // Compress for poor networks (max 1600 px, q=0.8) while recording the original hash.
      const scale = Math.min(1, 1600 / Math.max(full.width, full.height));
      let upload = original;
      let compressed = false;
      if (scale < 1 || original.size > 900_000) {
        const c = document.createElement('canvas');
        c.width = Math.round(full.width * scale);
        c.height = Math.round(full.height * scale);
        c.getContext('2d')!.drawImage(full, 0, 0, c.width, c.height);
        upload = await toBlob(c, 0.8);
        compressed = true;
      }
      onCapture({ blob: upload, originalSha256, uploadSha256: await sha256Hex(upload), compressed, capturedAt: new Date().toISOString(), width: full.width, height: full.height });
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <Button onClick={() => setOpen(true)} size="lg" block>
        {label}
      </Button>
    );
  return (
    <div className="stack-sm">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <video ref={video} playsInline muted style={{ width: '100%', borderRadius: 12, background: '#000', aspectRatio: '4/3', objectFit: 'cover' }} />
      <div className="row">
        <Button size="lg" loading={busy} onClick={() => void shoot()} style={{ flex: 1 }}>
          Take photo
        </Button>
        <Button variant="secondary" size="lg" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
