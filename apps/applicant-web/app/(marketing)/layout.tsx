import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { MarketingShell } from '@/components/marketing';

/** Marketing pages can be disabled (deployed separately) with NEXT_PUBLIC_MARKETING_ENABLED=false. */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  if (process.env.NEXT_PUBLIC_MARKETING_ENABLED === 'false') redirect('/dashboard');
  return <MarketingShell>{children}</MarketingShell>;
}
