'use client';
import { useState } from 'react';
import { ORG_ROLES, ORG_ROLE_PERMISSIONS, type OrgRole } from '@avn/contracts';
import { Alert, Badge, Button, Card, DataTable, ErrorAlert, Modal, PageHeader, SelectInput, TextInput, formatDateTime, humanize, useAction, useApi, useAuth, useToast } from '@avn/ui';
import { api } from '@/lib/api';

interface Member { id: string; fullName: string; email: string; role: OrgRole; status: string; lastLoginAt: string | null; mfaEnabled: boolean }

export default function Page() {
  const toast = useToast();
  const { can, me } = useAuth();
  const q = useApi<Member[]>(api, '/org/members');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ fullName: '', email: '', role: 'VERIFICATION_OFFICER' });
  const [devLink, setDevLink] = useState<string>();
  const invite = useAction(async () => {
    const r = await api.post<{ devInviteLink?: string }>('/org/members', f);
    setDevLink(r.devInviteLink);
    toast('Invitation sent');
    setOpen(false);
    await q.reload();
  });
  const manage = can('team.manage');
  return (
    <>
      <PageHeader title="Team" subtitle="Roles are enforced on every API call." actions={manage ? <Button onClick={() => setOpen(true)}>Invite member</Button> : null} />
      {devLink ? <Alert tone="warning" title="Development simulator — invitation email not sent">Open: <a href={devLink}>{devLink}</a></Alert> : null}
      <DataTable rows={q.data ?? []} rowKey={(m) => m.id} columns={[
        { key: 'n', header: 'Name', render: (m) => <div><strong>{m.fullName}</strong><div className="small muted">{m.email}</div></div> },
        { key: 'r', header: 'Role', render: (m) => manage && m.email !== me?.email ? (
          <select className="select" aria-label={`Role for ${m.fullName}`} value={m.role} onChange={async (e) => { try { await api.patch(`/org/members/${m.id}`, { role: e.target.value }); toast('Role updated'); } catch (err) { toast((err as Error).message, true); } await q.reload(); }}>
            {ORG_ROLES.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
          </select>
        ) : humanize(m.role) },
        { key: 's', header: 'Status', render: (m) => <Badge tone={m.status === 'ACTIVE' ? 'success' : undefined}>{humanize(m.status)}</Badge> },
        { key: 'mfa', header: 'MFA', render: (m) => (m.mfaEnabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>) },
        { key: 'l', header: 'Last sign-in', render: (m) => formatDateTime(m.lastLoginAt) },
        { key: 'x', header: '', render: (m) => manage && m.email !== me?.email && m.status === 'ACTIVE' && m.role !== 'OWNER' ? <Button variant="ghost" size="sm" onClick={async () => { await api.del(`/org/members/${m.id}`); await q.reload(); }}>Remove</Button> : null },
      ]} />
      <Card title="Role permissions">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Role</th><th>Permissions</th></tr></thead>
            <tbody>{ORG_ROLES.map((r) => <tr key={r}><td>{humanize(r)}</td><td className="small">{ORG_ROLE_PERMISSIONS[r].join(', ')}</td></tr>)}</tbody>
          </table>
        </div>
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Invite a team member">
        <div className="stack">
          <TextInput label="Full name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
          <TextInput label="Work email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <SelectInput label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} options={ORG_ROLES.map((r) => ({ value: r, label: humanize(r) }))} />
          <ErrorAlert error={invite.error} />
          <Button loading={invite.pending} onClick={() => void invite.run()}>Send invitation</Button>
        </div>
      </Modal>
    </>
  );
}
