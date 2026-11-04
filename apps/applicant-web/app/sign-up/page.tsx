'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AuthLayout, Button, ErrorAlert, TextInput, useAction, useAuth } from '@avn/ui';
import { OtpFlow } from '@/components/otp-flow';
import { api } from '@/lib/api';

export default function Page() {
  const [method, setMethod] = useState<'phone' | 'email'>('phone');
  const [f, setF] = useState({ fullName: '', email: '', phone: '', password: '' });
  const router = useRouter();
  const { refresh } = useAuth();
  const reg = useAction(async () => {
    await api.post('/auth/register', f);
    await refresh();
    router.replace('/dashboard');
  });
  const fe = reg.error?.fieldErrors() ?? {};
  return (
    <AuthLayout title="Create your AVN account" subtitle="Verify your residential address for yourself or an institution." footer={<>Already registered? <Link href="/sign-in">Sign in</Link></>}>
      <div className="segmented" style={{ marginBottom: 16 }}>
        <button aria-pressed={method === 'phone'} onClick={() => setMethod('phone')}>Phone</button>
        <button aria-pressed={method === 'email'} onClick={() => setMethod('email')}>Email</button>
      </div>
      {method === 'phone' ? (
        <OtpFlow mode="REGISTER" />
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void reg.run(); }}>
          <ErrorAlert error={reg.error && !Object.keys(fe).length ? reg.error : undefined} />
          <TextInput label="Full name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} error={fe.fullName} required />
          <TextInput label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} error={fe.email} required />
          <TextInput label="Phone number" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} error={fe.phone} required />
          <TextInput label="Password" type="password" autoComplete="new-password" hint="10+ characters with upper- and lower-case letters and a number." value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} error={fe.password} required />
          <Button type="submit" block size="lg" loading={reg.pending}>Create account</Button>
        </form>
      )}
    </AuthLayout>
  );
}
