'use client';
import Link from 'next/link';
import { PasswordSignIn } from '@avn/ui';
import { api } from '@/lib/api';

export default function Page() {
  return <PasswordSignIn client={api} title="Institution sign in" footer={<>New organisation? <Link href="/sign-up">Register</Link></>} demoHint="Demo: owner@demobank.test, officer@demobank.test, finance@demobank.test, auditor@demobank.test / AvnDemo2026!" />;
}
