'use client';
import { PasswordSignIn } from '@avn/ui';
import { api } from '@/lib/api';

export default function Page() {
  return <PasswordSignIn client={api} title="Admin sign in" demoHint="Demo: super@avn.local, ops@avn.local, reviewer@avn.local, finance@avn.local / AvnDemo2026!" />;
}
