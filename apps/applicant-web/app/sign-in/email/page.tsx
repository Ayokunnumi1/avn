'use client';
import Link from 'next/link';
import { PasswordSignIn } from '@avn/ui';
import { api } from '@/lib/api';

export default function Page() {
  return <PasswordSignIn client={api} footer={<Link href="/sign-in">Use phone number instead</Link>} demoHint="Demo: applicant01@avn.local / AvnDemo2026!" />;
}
