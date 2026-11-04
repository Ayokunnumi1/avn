'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, ApiError, Button, ErrorAlert, TextInput, useAuth } from '@avn/ui';
import { api } from '@/lib/api';

/** Phone OTP sign-in / registration. Registration asks for a name only when the number is new. */
export function OtpFlow({ mode, next = '/dashboard' }: { mode: 'LOGIN' | 'REGISTER'; next?: string }) {
  const router = useRouter();
  const { refresh } = useAuth();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [needName, setNeedName] = useState(mode === 'REGISTER');
  const [devCode, setDevCode] = useState<string>();
  const [error, setError] = useState<ApiError>();
  const [pending, setPending] = useState(false);
  const purpose = mode === 'REGISTER' ? 'REGISTER' : 'LOGIN';

  async function send(e?: FormEvent) {
    e?.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const r = await api.post<{ devCode?: string }>('/auth/otp/request', { phone, purpose });
      setDevCode(r.devCode);
      setStep('code');
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setPending(false);
    }
  }
  async function verify(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      await api.post('/auth/otp/verify', { phone, code, purpose, ...(needName && fullName ? { fullName } : {}) });
      await refresh();
      router.replace(next);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REGISTRATION_REQUIRED') {
        setNeedName(true);
        setError(new ApiError(404, err.code, 'This number is new to AVN. Add your name to create your account, then request a fresh code.'));
        setStep('phone');
      } else setError(err as ApiError);
    } finally {
      setPending(false);
    }
  }

  return step === 'phone' ? (
    <form className="stack" onSubmit={send}>
      <ErrorAlert error={error} />
      {needName ? <TextInput label="Full name" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required /> : null}
      <TextInput label="Phone number" type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} hint="We'll text you a 6-digit code." required />
      <Button type="submit" block size="lg" loading={pending}>
        Send code
      </Button>
    </form>
  ) : (
    <form className="stack" onSubmit={verify}>
      <ErrorAlert error={error} />
      {devCode ? (
        <Alert tone="warning" title="Development simulator">
          SMS is not sent in development. Your code is <strong className="mono">{devCode}</strong>
        </Alert>
      ) : null}
      <TextInput label="6-digit code" inputMode="numeric" autoComplete="one-time-code" className="input otp-input" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
      <Button type="submit" block size="lg" loading={pending}>
        Verify and continue
      </Button>
      <div className="row between small">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep('phone')}>
          Change number
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void send()}>
          Resend code
        </button>
      </div>
    </form>
  );
}
