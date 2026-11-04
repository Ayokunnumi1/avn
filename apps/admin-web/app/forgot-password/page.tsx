'use client';
import { ForgotPasswordPage } from '@avn/ui';
import { api } from '@/lib/api';

export default function Page() {
  return <ForgotPasswordPage client={api} />;
}
