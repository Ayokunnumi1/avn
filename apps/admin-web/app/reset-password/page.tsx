'use client';
import { ResetPasswordPage } from '@avn/ui';
import { api } from '@/lib/api';

export default function Page() {
  return <ResetPasswordPage client={api} />;
}
