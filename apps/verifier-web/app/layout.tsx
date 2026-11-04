import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@avn/ui/styles.css';
import 'leaflet/dist/leaflet.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: { default: 'AVN Agent', template: '%s · AVN Agent' },
  description: 'AVN — Digital Address Verification Network',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon.svg', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'AVN Agent', statusBarStyle: 'default' },
};
export const viewport: Viewport = { themeColor: '#0b5e58', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
