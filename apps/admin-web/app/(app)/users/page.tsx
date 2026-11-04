'use client';
import { useState } from 'react';
import { ACCOUNT_TYPES } from '@avn/contracts';
import { Badge, DataTable, PageHeader, Pagination, SelectInput, Spinner, TextInput, ToneBadge, formatDateTime, humanize, useApi, useToast } from '@avn/ui';
import { api } from '@/lib/api';
import { ConfirmAction } from '@/components/confirm';

interface U { id: string; fullName: string; email: string | null; phone: string | null; accountType: string; status: string; isGuest: boolean; adminRole: string | null; mfaEnabled: boolean; verifierStatus: string | null; organisation: string | null; orgRole: string | null; lastLoginAt: string | null }

export default function Page() {
  const toast = useToast();
  const [f, setF] = useState({ type: '', status: '', q: '' });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams(Object.entries({ ...f, page: String(page), pageSize: '25' }).filter(([, v]) => v) as [string, string][]).toString();
  const q = useApi<{ items: U[]; total: number; page: number; pageSize: number }>(api, `/admin/users?${qs}`);
  const setStatus = (u: U, status: string) => async ({ reason }: { reason: string }) => {
    await api.patch(`/admin/users/${u.id}/status`, { status, reason });
    toast(status === 'SUSPENDED' ? 'User suspended and signed out everywhere' : 'User reinstated');
    await q.reload();
  };
  return (
    <>
      <PageHeader title="Users" subtitle="Applicants, verifiers, institutional users and administrators." />
      <div className="grid grid-3">
        <TextInput label="Search" value={f.q} onChange={(e) => { setPage(1); setF({ ...f, q: e.target.value }); }} />
        <SelectInput label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={[{ value: '', label: 'All' }, ...ACCOUNT_TYPES.map((t) => ({ value: t, label: humanize(t) }))]} />
        <SelectInput label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={[{ value: '', label: 'All' }, ...['ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'PENDING'].map((s) => ({ value: s, label: humanize(s) }))]} />
      </div>
      {q.loading ? <Spinner /> : <>
        <DataTable rows={q.data!.items} rowKey={(u) => u.id} columns={[
          { key: 'n', header: 'User', render: (u) => <div><strong>{u.fullName}</strong><div className="small muted">{u.email ?? u.phone}</div></div> },
          { key: 't', header: 'Type', render: (u) => <span>{humanize(u.accountType)}{u.isGuest ? <Badge>guest</Badge> : null}<div className="small muted">{u.adminRole ? humanize(u.adminRole) : u.organisation ? `${u.organisation} · ${humanize(u.orgRole)}` : u.verifierStatus ? `Verifier ${humanize(u.verifierStatus)}` : ''}</div></span> },
          { key: 's', header: 'Status', render: (u) => <ToneBadge value={u.status} /> },
          { key: 'm', header: 'MFA', render: (u) => (u.mfaEnabled ? 'On' : 'Off') },
          { key: 'l', header: 'Last sign-in', render: (u) => formatDateTime(u.lastLoginAt) },
          { key: 'a', header: '', render: (u) => (u.status === 'ACTIVE' ? <ConfirmAction trigger="Suspend" variant="danger" title={`Suspend ${u.fullName}`} onConfirm={setStatus(u, 'SUSPENDED')} /> : u.status === 'SUSPENDED' ? <ConfirmAction trigger="Reinstate" title={`Reinstate ${u.fullName}`} onConfirm={setStatus(u, 'ACTIVE')} /> : null) },
        ]} />
        <Pagination page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={setPage} />
      </>}
    </>
  );
}
