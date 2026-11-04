'use client';
import { useRouter } from 'next/navigation';
import { Alert, PageHeader, useAuth } from '@avn/ui';
import { VerificationWizard } from '@/components/wizard';

export default function Page() {
  const router = useRouter();
  const { me } = useAuth();
  if (me?.isGuest) return <Alert tone="info">Sign in with your phone number to order your own verifications.</Alert>;
  return (
    <>
      <PageHeader title="New verification" subtitle="Takes about three minutes. Your progress is saved on this device." />
      <VerificationWizard defaultName={me?.fullName} onDone={(_id, payUrl) => (payUrl ? (window.location.href = payUrl) : router.push('/verifications'))} />
    </>
  );
}
