import type { AppAudience } from '@avn/contracts';

/** Error thrown for any non-2xx API response, carrying the server's error envelope. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** Field → message map from Zod validation details (for accessible form errors). */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const d of this.details as Array<{ path?: string; message?: string }>) if (d.path && d.message && !out[d.path]) out[d.path] = d.message;
    }
    return out;
  }
}

export interface ApiClient {
  audience: AppAudience;
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T>;
  put<T = unknown>(path: string, body?: unknown): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown): Promise<T>;
  del<T = unknown>(path: string): Promise<T>;
  upload<T = unknown>(path: string, form: FormData): Promise<T>;
  url(path: string): string;
}

/**
 * Same-origin client: each PWA proxies /api/* to the API server, so the httpOnly session
 * cookie never leaves the app's own origin. The X-AVN-App header selects the audience
 * and doubles as CSRF protection.
 */
export function createApiClient(audience: AppAudience): ApiClient {
  async function request<T>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}, form?: FormData): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`/api/v1${path}`, {
        method,
        credentials: 'same-origin',
        headers: { 'X-AVN-App': audience, ...(form ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
        body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
        cache: 'no-store',
      });
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', 'You appear to be offline. Check your connection and try again.');
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const e = (json as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
      throw new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? `Request failed (${res.status})`, e?.details);
    }
    return json as T;
  }
  return {
    audience,
    get: (p) => request('GET', p),
    post: (p, b, h) => request('POST', p, b ?? {}, h),
    put: (p, b) => request('PUT', p, b ?? {}),
    patch: (p, b) => request('PATCH', p, b ?? {}),
    del: (p) => request('DELETE', p),
    upload: (p, form) => request('POST', p, undefined, {}, form),
    url: (p) => `/api/v1${p}`,
  };
}

/** Downloads an authenticated binary (PDF/CSV) and triggers a save. */
export async function downloadFile(audience: AppAudience, path: string, filename: string): Promise<void> {
  const res = await fetch(`/api/v1${path}`, { headers: { 'X-AVN-App': audience }, credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD_FAILED', 'Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const newIdempotencyKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
