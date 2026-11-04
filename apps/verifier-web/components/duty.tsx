'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, useAuth, useToast } from '@avn/ui';
import { api } from '@/lib/api';

/**
 * Active-duty controller (spec B4). Browsers do not guarantee background geolocation, so
 * duty only runs while this app is open in the foreground: watchPosition + a heartbeat
 * every 30 s. The server expires the session if heartbeats stop, and stale coordinates
 * are never shown as live.
 */
export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
  at: number;
  mocked?: boolean;
}
interface DutyState {
  available: boolean;
  starting: boolean;
  fix: Fix | null;
  lastBeatAt: number | null;
  offers: number;
  error: string | null;
  goAvailable: () => Promise<void>;
  goUnavailable: () => Promise<void>;
  getFix: (timeoutMs?: number) => Promise<Fix>;
}
const Ctx = createContext<DutyState | null>(null);
const HEARTBEAT_MS = 30_000;

export function currentFix(timeoutMs = 15000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available on this device'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp, mocked: (p as unknown as { mocked?: boolean }).mocked }),
      (e) => reject(new Error(e.code === 1 ? 'Location permission denied. Enable location for this app to go on duty.' : 'Could not get a GPS fix. Move to open sky and retry.')),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

export function DutyProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const toast = useToast();
  const [available, setAvailable] = useState(false);
  const [starting, setStarting] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [lastBeatAt, setLastBeatAt] = useState<number | null>(null);
  const [offers, setOffers] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<string | null>(null);
  const watch = useRef<number | null>(null);
  const fixRef = useRef<Fix | null>(null);

  const stopWatching = () => {
    if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
  };

  // Restore state from the server (e.g. after a reload while on duty).
  useEffect(() => {
    if (me?.verifier?.status !== 'APPROVED') return;
    void api.get<{ availability: { available: boolean; sessionId: string | null } }>('/verifiers/me').then((v) => {
      if (v.availability.available && v.availability.sessionId) {
        session.current = v.availability.sessionId;
        setAvailable(true);
      }
    });
  }, [me?.verifier?.status]);

  useEffect(() => {
    if (!available) {
      stopWatching();
      return;
    }
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        const f = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp };
        fixRef.current = f;
        setFix(f);
      },
      () => setError('Location signal lost — keep the app open with location enabled.'),
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
    const beat = async () => {
      const f = fixRef.current;
      if (!f || !session.current) return;
      try {
        const r = await api.post<{ offers: number }>('/verifiers/me/heartbeat', { lat: f.lat, lng: f.lng, accuracyM: f.accuracy, recordedAt: new Date(f.at).toISOString(), sessionId: session.current });
        setLastBeatAt(Date.now());
        setOffers(r.offers);
        setError(null);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'DUTY_SESSION_ENDED') {
          setAvailable(false);
          session.current = null;
          toast('Your duty session ended because location updates stopped.', true);
        } else setError(e instanceof Error ? e.message : 'Heartbeat failed');
      }
    };
    const t = setInterval(beat, HEARTBEAT_MS);
    void beat();
    return () => {
      clearInterval(t);
      stopWatching();
    };
  }, [available, toast]);

  const goAvailable = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const f = await currentFix();
      fixRef.current = f;
      setFix(f);
      const r = await api.post<{ sessionId: string }>('/verifiers/me/availability', { available: true, lat: f.lat, lng: f.lng, accuracyM: f.accuracy });
      session.current = r.sessionId;
      setLastBeatAt(Date.now());
      setAvailable(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not go available');
    } finally {
      setStarting(false);
    }
  }, []);

  const goUnavailable = useCallback(async () => {
    stopWatching();
    setAvailable(false);
    session.current = null;
    fixRef.current = null;
    setFix(null);
    await api.post('/verifiers/me/availability', { available: false }).catch(() => undefined);
  }, []);

  return <Ctx.Provider value={{ available, starting, fix, lastBeatAt, offers, error, goAvailable, goUnavailable, getFix: currentFix }}>{children}</Ctx.Provider>;
}

export function useDuty(): DutyState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDuty outside DutyProvider');
  return v;
}

export function DutyBar() {
  const { available, lastBeatAt, offers, error } = useDuty();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  if (!available) return null;
  const age = lastBeatAt ? Math.round((now - lastBeatAt) / 1000) : null;
  return (
    <div className="net-banner" role="status" style={{ background: error ? '#7a2e0e' : 'var(--primary)', color: '#fff' }}>
      ● On duty — keep this app open{age != null ? ` · location sent ${age}s ago` : ''}
      {offers ? ` · ${offers} job offer${offers > 1 ? 's' : ''} waiting` : ''}
      {error ? ` · ${error}` : ''}
    </div>
  );
}
