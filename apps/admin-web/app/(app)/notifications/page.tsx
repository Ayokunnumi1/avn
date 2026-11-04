'use client';
import { NotificationsView, PageHeader } from '@avn/ui';
import { api } from '@/lib/api';

export default function Page() {
  return (
    <>
      <PageHeader title="Notifications" />
      <NotificationsView client={api} />
    </>
  );
}
