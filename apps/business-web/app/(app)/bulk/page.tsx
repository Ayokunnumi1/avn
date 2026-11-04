'use client';
import { useState } from 'react';
import { Alert, Badge, Button, Card, DataTable, ErrorAlert, PageHeader, downloadFile, formatDateTime, humanize, useAction, useApi, useToast } from '@avn/ui';
import { api } from '@/lib/api';

interface Preview { id: string; totalRows: number; validRows: number; invalidRows: number; errors: Array<{ row: number; field: string; message: string }>; preview: Array<Record<string, unknown> & { row: number }> }
interface Hist { id: string; fileName: string; status: string; totalRows: number; validRows: number; invalidRows: number; processedRows: number; failedRows: number; createdAt: string }

export default function Page() {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const hist = useApi<Hist[]>(api, '/org/bulk', { pollMs: 8000 });
  const upload = useAction(async () => {
    const f = new FormData();
    f.append('file', file!);
    setPreview(await api.upload<Preview>('/org/bulk', f));
    await hist.reload();
  });
  const confirm = useAction(async () => {
    await api.post(`/org/bulk/${preview!.id}/confirm`);
    toast(`Processing ${preview!.validRows} valid rows in the background`);
    setPreview(null);
    setFile(null);
    await hist.reload();
  });
  return (
    <>
      <PageHeader title="Bulk verification" subtitle="Upload a CSV, review validation results, then process valid rows asynchronously." actions={<Button variant="secondary" onClick={() => void downloadFile('business', '/org/bulk/template.csv', 'avn-bulk-template.csv')}>Download template</Button>} />
      <Card title="1. Upload CSV">
        <div className="stack">
          <p className="small muted">Columns: applicant_name, applicant_phone, applicant_email, customer_reference, level, purpose, priority, department, instructions. Up to 5,000 rows.</p>
          <input className="input" type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <ErrorAlert error={upload.error} />
          <Button disabled={!file} loading={upload.pending} onClick={() => void upload.run()}>Validate file</Button>
        </div>
      </Card>
      {preview ? (
        <Card title="2. Review" actions={<Button variant="secondary" size="sm" onClick={() => void downloadFile('business', `/org/bulk/${preview.id}/errors.csv`, 'errors.csv')}>Download error report</Button>}>
          <div className="stack">
            <div className="row">
              <Badge>{preview.totalRows} rows</Badge>
              <Badge tone="success">{preview.validRows} valid</Badge>
              <Badge tone={preview.invalidRows ? 'danger' : undefined}>{preview.invalidRows} invalid</Badge>
            </div>
            {preview.errors.length ? (
              <DataTable rows={preview.errors.slice(0, 50)} rowKey={(e) => `${e.row}-${e.field}-${e.message}`} columns={[{ key: 'r', header: 'Row', render: (e) => e.row }, { key: 'f', header: 'Field', render: (e) => e.field }, { key: 'm', header: 'Problem', render: (e) => e.message }]} />
            ) : <Alert tone="success">All rows are valid.</Alert>}
            <h3>Preview of valid rows</h3>
            <DataTable rows={preview.preview} rowKey={(r) => String(r.row)} empty="No valid rows" columns={[{ key: 'r', header: 'Row', render: (r) => r.row }, { key: 'n', header: 'Applicant', render: (r) => String(r.applicantName) }, { key: 'p', header: 'Phone', render: (r) => String(r.applicantPhone) }, { key: 'c', header: 'Customer ref', render: (r) => String(r.customerReference) }, { key: 'l', header: 'Level', render: (r) => String(r.level) }]} />
            <ErrorAlert error={confirm.error} />
            <div className="row">
              <Button disabled={!preview.validRows} loading={confirm.pending} onClick={() => void confirm.run()}>Process {preview.validRows} valid rows</Button>
              <Button variant="ghost" onClick={async () => { await api.del(`/org/bulk/${preview.id}`); setPreview(null); await hist.reload(); }}>Discard</Button>
            </div>
          </div>
        </Card>
      ) : null}
      <Card title="History">
        <DataTable rows={hist.data ?? []} rowKey={(h) => h.id} empty="No uploads yet" columns={[
          { key: 'f', header: 'File', render: (h) => h.fileName },
          { key: 's', header: 'Status', render: (h) => <Badge tone={h.status === 'COMPLETED' ? 'success' : h.status === 'PROCESSING' ? 'info' : undefined}>{humanize(h.status)}</Badge> },
          { key: 'v', header: 'Valid / total', render: (h) => `${h.validRows} / ${h.totalRows}` },
          { key: 'p', header: 'Processed', render: (h) => `${h.processedRows}${h.failedRows ? ` (${h.failedRows} failed)` : ''}` },
          { key: 'd', header: 'Uploaded', render: (h) => formatDateTime(h.createdAt) },
          { key: 'e', header: '', render: (h) => (h.invalidRows || h.failedRows ? <button className="btn btn-ghost btn-sm" onClick={() => void downloadFile('business', `/org/bulk/${h.id}/errors.csv`, 'errors.csv')}>Errors</button> : null) },
        ]} />
      </Card>
    </>
  );
}
