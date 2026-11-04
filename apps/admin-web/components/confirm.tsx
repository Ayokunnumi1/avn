'use client';
import { useState, type ReactNode } from 'react';
import { Button, ErrorAlert, Modal, TextArea, TextInput, useAction } from '@avn/ui';

/** Privileged-action dialog: reason + (optionally) password re-confirmation (spec D1). */
export function ConfirmAction({ trigger, title, needPassword, needReason = true, onConfirm, variant = 'primary', children }: { trigger: string; title: string; needPassword?: boolean; needReason?: boolean; onConfirm: (v: { reason: string; password: string }) => Promise<void>; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const act = useAction(async () => {
    await onConfirm({ reason, password });
    setOpen(false);
    setReason('');
    setPassword('');
  });
  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)}>{trigger}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <div className="stack">
          {children}
          {needReason ? <TextArea label="Reason (recorded in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} /> : null}
          {needPassword ? <TextInput label="Confirm your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /> : null}
          <ErrorAlert error={act.error} />
          <Button variant={variant === 'ghost' ? 'primary' : variant} loading={act.pending} disabled={(needReason && reason.length < 3) || (needPassword && !password)} onClick={() => void act.run()}>Confirm</Button>
        </div>
      </Modal>
    </>
  );
}
