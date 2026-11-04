'use client';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { STATUS_LABELS, type RequestStatus } from '@avn/contracts';
import type { ApiError } from './api';
import { Icon } from './icons';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'primary', size, block, loading, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'lg'; block?: boolean; loading?: boolean }) {
  return (
    <button className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${block ? 'btn-block' : ''} ${className}`} disabled={loading || rest.disabled} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner" style={{ width: 16, height: 16, borderTopColor: 'currentColor' }} aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Card({ children, className = '', title, actions, as: As = 'section' }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; as?: 'section' | 'div' | 'article' }) {
  return (
    <As className={`card ${className}`}>
      {title || actions ? (
        <div className="card-header">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions ? <div className="row">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </As>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'warning' | 'danger' | 'success' }) {
  return (
    <div className="card stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={tone ? { color: `var(--${tone})` } : undefined}>
        {value}
      </span>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: 'success' | 'warning' | 'danger' | 'info' | 'primary' }) {
  return <span className={`badge ${tone ? `badge-${tone}` : ''}`}>{children}</span>;
}

const STATUS_TONE: Partial<Record<RequestStatus, 'success' | 'warning' | 'danger' | 'info' | 'primary'>> = {
  COMPLETED: 'success',
  PARTIALLY_VERIFIED: 'warning',
  NOT_VERIFIED: 'danger',
  INCONCLUSIVE: 'warning',
  MANUAL_REVIEW: 'warning',
  CANCELLED: undefined,
  EXPIRED: undefined,
  AWAITING_APPLICANT: 'info',
  DISPATCHING: 'info',
  READY_FOR_ASSIGNMENT: 'info',
  ACCEPTED: 'primary',
  EN_ROUTE: 'primary',
  ARRIVED: 'primary',
  VISIT_IN_PROGRESS: 'primary',
  EVIDENCE_SUBMITTED: 'primary',
  PROCESSING: 'primary',
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status as RequestStatus]}>{STATUS_LABELS[status as RequestStatus] ?? status.replace(/_/g, ' ').toLowerCase()}</Badge>;
}
export function ToneBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <Badge>—</Badge>;
  const v = value.toUpperCase();
  const tone = /APPROVED|PASSED|SUCCEEDED|COMPLETED|VERIFIED|CONFIRMED|ACTIVE|SENT|VALID|RESOLVED|UPHELD/.test(v) && !/NOT_|PARTIAL/.test(v)
    ? 'success'
    : /REJECTED|FAILED|SUSPENDED|NOT_VERIFIED|CONTRADICTED|HIGH|DANGER|TAMPERED|REVOKED/.test(v)
      ? 'danger'
      : /PENDING|REVIEW|PARTIAL|MEDIUM|REQUESTED|OPEN|QUEUED|INITIATED|INCONCLUSIVE|UNABLE|EXPIRED|STALE/.test(v)
        ? 'warning'
        : 'info';
  return <Badge tone={tone}>{value.replace(/_/g, ' ').toLowerCase()}</Badge>;
}

export function Alert({ tone = 'info', children, title }: { tone?: 'info' | 'success' | 'warning' | 'danger'; children: ReactNode; title?: string }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={tone === 'success' ? 'check' : tone === 'info' ? 'bell' : 'alert'} size={18} />
      <div>
        {title ? <strong style={{ display: 'block' }}>{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}

export function ErrorAlert({ error }: { error?: ApiError | null }) {
  if (!error) return null;
  return <Alert tone="danger">{error.message}</Alert>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="row" role="status" aria-live="polite" style={{ padding: 24, justifyContent: 'center' }}>
      <span className="spinner" aria-hidden />
      <span className="muted small">{label}…</span>
    </div>
  );
}

export function EmptyState({ title, children, icon = 'inbox' }: { title: string; children?: ReactNode; icon?: string }) {
  return (
    <div className="empty">
      <Icon name={icon} size={30} />
      <p style={{ fontWeight: 700, color: 'var(--text)', margin: '8px 0 4px' }}>{title}</p>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode;
  required?: boolean;
}
export function Field({ label, hint, error, children, required }: FieldProps) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true" style={{ color: 'var(--danger)' }}> *</span> : null}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint ? (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="error-text" id={`${id}-err`} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function TextInput({ label, hint, error, required, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & { label: string; hint?: ReactNode; error?: string }) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {(p) => <input className="input" required={required} {...p} {...rest} />}
    </Field>
  );
}
export function SelectInput({ label, hint, error, options, required, ...rest }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & { label: string; hint?: ReactNode; error?: string; options: Array<{ value: string; label: string }> }) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {(p) => (
        <select className="select" required={required} {...p} {...rest}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
export function TextArea({ label, hint, error, required, ...rest }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & { label: string; hint?: ReactNode; error?: string }) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {(p) => <textarea className="textarea" required={required} {...p} {...rest} />}
    </Field>
  );
}
export function Checkbox({ label, checked, onChange, description }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; description?: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {description ? <span className="hint" style={{ display: 'block' }}>{description}</span> : null}
      </span>
    </label>
  );
}

/** Accessible three-way / multi-option toggle (large touch targets for field use). */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T | undefined; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="field" role="group" aria-label={label}>
      <span className="label">{label}</span>
      <div className="segmented">
        {options.map((o) => (
          <button type="button" key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  width?: string | number;
}
export function DataTable<T>({ rows, columns, onRowClick, empty = 'Nothing here yet', rowKey }: { rows: T[]; columns: Column<T>[]; onRowClick?: (row: T) => void; empty?: string; rowKey: (row: T) => string }) {
  if (!rows.length) return <EmptyState title={empty} />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" style={{ width: c.width }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              className={onRowClick ? 'clickable' : undefined}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => (e.key === 'Enter' ? onRowClick(r) : undefined) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
            >
              {columns.map((c) => (
                <td key={c.key}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="row between small muted" style={{ marginTop: 12 }}>
      <span>
        {total} result{total === 1 ? '' : 's'} · page {page} of {pages}
      </span>
      <div className="row">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function KeyValue({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="kv">
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,button,select,textarea')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close dialog">
            <Icon name="x" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Timeline({ steps }: { steps: Array<{ key: string; label: string; done: boolean; current?: boolean; at?: string | null }> }) {
  return (
    <ol className="timeline">
      {steps.map((s) => (
        <li key={s.key} className={`${s.done ? 'done' : ''} ${s.current ? 'current' : ''}`} aria-current={s.current ? 'step' : undefined}>
          <span className="dot">{s.done ? <Icon name="check" size={14} /> : null}</span>
          <div>
            <div style={{ fontWeight: 650, color: s.done || s.current ? 'var(--text)' : 'var(--muted)' }}>{s.label}</div>
            {s.at ? <div className="small muted">{formatDateTime(s.at)}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Steps({ total, current }: { total: number; current: number }) {
  return (
    <div className="steps" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current + 1} aria-label={`Step ${current + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i <= current ? 'on' : ''} />
      ))}
    </div>
  );
}

// ─── Formatting (UTC stored, shown in the user's timezone) ───────────────────
export function formatMoney(value: string | number | null | undefined, currency = 'NGN') {
  if (value == null || value === '') return '—';
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency, minimumFractionDigits: 2 }).format(Number(value));
}
export function formatDateTime(value: string | Date | null | undefined, timeZone = 'Africa/Lagos') {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value));
}
export function formatDate(value: string | Date | null | undefined, timeZone = 'Africa/Lagos') {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone }).format(new Date(value));
}
export function timeAgo(value: string | Date | null | undefined) {
  if (!value) return '—';
  const s = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
export const humanize = (v: string | null | undefined) => (v ? v.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '—');

// ─── Toasts ──────────────────────────────────────────────────────────────────
interface ToastItem {
  id: number;
  text: string;
  error?: boolean;
}
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, error?: boolean) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, error }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-region" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.error ? 'error' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
