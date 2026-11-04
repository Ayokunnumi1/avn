'use client';
import { useEffect, useRef, useState } from 'react';
import type * as L from 'leaflet';

/**
 * Leaflet map (OpenStreetMap tiles by default; override with NEXT_PUBLIC_MAP_TILE_URL).
 * Loaded on the client only. Supports markers, a route polyline, accuracy circle and
 * click/drag pin placement for exact property selection.
 */
export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  color?: string;
}
export interface MapViewProps {
  center: { lat: number; lng: number };
  zoom?: number;
  markers?: MapMarker[];
  route?: Array<{ lat: number; lng: number }>;
  pin?: { lat: number; lng: number } | null;
  onPinChange?: (p: { lat: number; lng: number }) => void;
  accuracy?: { lat: number; lng: number; radiusM: number } | null;
  className?: string;
  ariaLabel?: string;
  fitToContent?: boolean;
}

const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

function dot(Lf: typeof L, color: string) {
  return Lf.divIcon({ className: '', html: `<span style="display:block;width:16px;height:16px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>`, iconSize: [16, 16], iconAnchor: [8, 8] });
}

export function MapView({ center, zoom = 16, markers = [], route, pin, onPinChange, accuracy, className = 'map', ariaLabel = 'Map', fitToContent }: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const lib = useRef<typeof L | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pinMarker = useRef<L.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const onPin = useRef(onPinChange);
  onPin.current = onPinChange;

  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then((mod) => {
      const Lf = (mod as unknown as { default?: typeof L }).default ?? (mod as unknown as typeof L);
      if (cancelled || !el.current || map.current) return;
      lib.current = Lf;
      const m = Lf.map(el.current, { zoomControl: true, attributionControl: true }).setView([center.lat, center.lng], zoom);
      Lf.tileLayer(TILE_URL, { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
      layer.current = Lf.layerGroup().addTo(m);
      if (onPin.current) {
        m.on('click', (e: L.LeafletMouseEvent) => onPin.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
      }
      map.current = m;
      setReady(true);
      setTimeout(() => m.invalidateSize(), 50);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const Lf = lib.current;
    const m = map.current;
    const g = layer.current;
    if (!ready || !Lf || !m || !g) return;
    g.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    for (const mk of markers) {
      const marker = Lf.marker([mk.lat, mk.lng], { icon: dot(Lf, mk.color ?? '#0f766e'), keyboard: true, title: mk.label });
      if (mk.label) marker.bindTooltip(mk.label);
      marker.addTo(g);
      bounds.push([mk.lat, mk.lng]);
    }
    if (route && route.length > 1) {
      Lf.polyline(route.map((p) => [p.lat, p.lng] as [number, number]), { color: '#0f766e', weight: 5, opacity: 0.8 }).addTo(g);
      route.forEach((p) => bounds.push([p.lat, p.lng]));
    }
    if (accuracy) Lf.circle([accuracy.lat, accuracy.lng], { radius: accuracy.radiusM, color: '#175cd3', weight: 1, fillOpacity: 0.08 }).addTo(g);
    if (pin) {
      if (!pinMarker.current) {
        pinMarker.current = Lf.marker([pin.lat, pin.lng], { draggable: !!onPin.current, icon: dot(Lf, '#b42318'), title: 'Selected property' });
        pinMarker.current.on('dragend', () => {
          const ll = pinMarker.current!.getLatLng();
          onPin.current?.({ lat: ll.lat, lng: ll.lng });
        });
        pinMarker.current.addTo(m);
      } else pinMarker.current.setLatLng([pin.lat, pin.lng]);
      bounds.push([pin.lat, pin.lng]);
    }
    if (fitToContent && bounds.length > 1) m.fitBounds(Lf.latLngBounds(bounds), { padding: [30, 30], maxZoom: 17 });
  }, [ready, markers, route, pin, accuracy, fitToContent]);

  useEffect(() => {
    if (map.current && !fitToContent) map.current.setView([center.lat, center.lng], map.current.getZoom());
  }, [center.lat, center.lng, fitToContent]);

  return <div ref={el} className={className} role="application" aria-label={ariaLabel} />;
}
