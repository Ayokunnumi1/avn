'use client';
import Link from 'next/link';
import { PasswordSignIn } from '@avn/ui';
import { api } from '@/lib/api';

export default function Page() {
  return <PasswordSignIn client={api} title="Agent sign in" footer={<>Want to earn as a verifier? <Link href="/sign-up">Register</Link></>} demoHint="Demo: verifier01@avn.local … verifier16@avn.local / AvnDemo2026!" />;
}
