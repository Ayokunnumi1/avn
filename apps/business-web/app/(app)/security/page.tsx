'use client';
import { SecuritySettings } from '@avn/ui';
import { api } from '@/lib/api';

export default function Page() {
  return <SecuritySettings client={api} />;
}
