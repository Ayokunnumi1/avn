'use client';
import { useEffect, useState } from 'react';
import { useOnline } from './hooks';

/**
 * PWA runtime: registers the service worker, surfaces "update available", shows a
 * network-state banner, and exposes the install prompt where the browser supports it.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export function PwaRuntime() {
  const online = useOnline();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
    let reg: ServiceWorkerRegistration | undefined;
    navigator.serviceWorker
      .register('/sw.js')
      .then((r) => {
        reg = r;
        if (r.waiting) setWaiting(r.waiting);
        r.addEventListener('updatefound', () => {
          const nw = r.installing;
          nw?.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) setWaiting(nw);
          });
        });
      })
      .catch(() => undefined);
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!reloaded) {
        reloaded = true;
        window.location.reload();
      }
    });
    const t = setInterval(() => void reg?.update(), 30 * 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      {!online ? (
        <div className="net-banner offline" role="status">
          You are offline. Drafts are kept on this device and will sync when you reconnect.
        </div>
      ) : null}
      {waiting ? (
        <div className="net-banner update" role="status">
          A new version of the app is available.
          <button onClick={() => waiting.postMessage({ type: 'SKIP_WAITING' })}>Update</button>
        </div>
      ) : null}
    </>
  );
}

export function InstallButton({ className = 'btn btn-secondary btn-sm' }: { className?: string }) {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  if (!evt) return null;
  return (
    <button className={className} onClick={() => void evt.prompt().then(() => setEvt(null))}>
      Install app
    </button>
  );
}

/** Subscribes this device to Web Push when the API has VAPID keys configured. */
export async function enablePush(client: { get: <T>(p: string) => Promise<T>; post: (p: string, b?: unknown) => Promise<unknown> }): Promise<'enabled' | 'unsupported' | 'denied' | 'not-configured'> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  const cfg = await client.get<{ enabled: boolean; publicKey: string | null }>('/notifications/push/config');
  if (!cfg.enabled || !cfg.publicKey) return 'not-configured';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(cfg.publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await client.post('/notifications/push/subscriptions', { endpoint: json.endpoint, keys: json.keys });
  return 'enabled';
}
