'use client';
import { NotificationsView, PageHeader } from '@avn/ui';
import { api } from '@/lib/api';

export default function Page() {
  return (
    <>
      <PageHeader title="Notifications" subtitle="In-app alerts. SMS and email copies are kept free of sensitive details." />
      <NotificationsView client={api} linkFor={(n) => (n.data?.requestId ? `/verifications/${n.data.requestId}` : null)} />
    </>
  );
}
