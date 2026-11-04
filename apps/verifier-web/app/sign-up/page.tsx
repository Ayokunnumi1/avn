'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AuthLayout, Button, ErrorAlert, Steps, TextArea, TextInput, useAction, useAuth } from '@avn/ui';
import { api } from '@/lib/api';

/** Step 1 of verifier onboarding — identity, photo and payout steps continue in the Profile page. */
export default function Page() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [f, setF] = useState({ fullName: '', phone: '', email: '', password: '', dateOfBirth: '', residentialAddress: '' });
  const reg = useAction(async () => {
    await api.post('/verifiers/register', f);
    await refresh();
    router.replace('/profile?onboarding=1');
  });
  const fe = reg.error?.fieldErrors() ?? {};
  return (
    <AuthLayout title="Become an AVN verifier" subtitle="Registration → identity verification → admin approval → start earning." footer={<>Already registered? <Link href="/sign-in">Sign in</Link></>}>
      <Steps total={4} current={0} />
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void reg.run(); }}>
        <ErrorAlert error={reg.error && !Object.keys(fe).length ? reg.error : undefined} />
        <TextInput label="Full legal name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} error={fe.fullName} required />
        <TextInput label="Phone number" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} error={fe.phone} required />
        <TextInput label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} error={fe.email} required />
        <TextInput label="Date of birth" type="date" value={f.dateOfBirth} onChange={(e) => setF({ ...f, dateOfBirth: e.target.value })} error={fe.dateOfBirth} required />
        <TextArea label="Residential address" value={f.residentialAddress} onChange={(e) => setF({ ...f, residentialAddress: e.target.value })} error={fe.residentialAddress} hint="Used for conflict-of-interest checks — you are never sent to verify your own home." required />
        <TextInput label="Password" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} error={fe.password} hint="10+ characters, upper & lower case and a number." required />
        <Button type="submit" block size="lg" loading={reg.pending}>Create account</Button>
      </form>
    </AuthLayout>
  );
}
