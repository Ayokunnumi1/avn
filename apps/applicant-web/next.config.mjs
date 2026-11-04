import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const isDev = process.env.NODE_ENV !== 'production';
const tiles = process.env.NEXT_PUBLIC_MAP_TILE_ORIGIN ?? 'https://*.tile.openstreetmap.org https://tile.openstreetmap.org';

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  `img-src 'self' data: blob: ${tiles}`,
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  `form-action 'self' ${process.env.API_PUBLIC_URL ?? 'http://localhost:4000'} https://checkout.paystack.com`,
].join('; ');

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  outputFileTracingRoot: path.join(dirname, '../../'),
  transpilePackages: ['@avn/ui', '@avn/contracts'],
  eslint: { ignoreDuringBuilds: true },
  // Same-origin proxy: the browser only ever talks to this app; httpOnly cookies stay first-party.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] },
    ];
  },
};
