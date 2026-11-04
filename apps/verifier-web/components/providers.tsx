'use client';
import type { ReactNode } from 'react';
import { AuthProvider, PwaRuntime, ToastProvider } from '@avn/ui';
import { api } from '@/lib/api';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider client={api}>
        <PwaRuntime />
        {children}
      </AuthProvider>
    </ToastProvider>
  );
}
