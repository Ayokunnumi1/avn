'use client';
import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthLayout, Spinner } from '@avn/ui';
import { OtpFlow } from '@/components/otp-flow';

function Inner() {
  const next = useSearchParams().get('next');
  return (
    <AuthLayout
      title="Sign in"
      subtitle="Use the phone number linked to your verifications."
      footer={
        <>
          New here? <Link href="/sign-up">Create an account</Link> · <Link href="/sign-in/email">Sign in with email</Link>
        </>
      }
    >
      <OtpFlow mode="LOGIN" next={next?.startsWith('/') ? next : '/dashboard'} />
    </AuthLayout>
  );
}
export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <Inner />
    </Suspense>
  );
}
