'use client';
import { useState } from 'react';
import { Badge, Button, Card, DataTable, ErrorAlert, PageHeader, TextInput, humanize, useAction } from '@avn/ui';
import { api } from '@/lib/api';

interface Answer { intent: string; period?: string; interpretedBy: 'ai' | 'rules'; answer: string; table?: Array<Record<string, unknown>> }
const EXAMPLES = ['Show all requests still waiting for agents.', 'How many applicants were unavailable this month?', 'What percentage of addresses required manual review?', 'Which locations have the highest failure rate?', 'Show our monthly verification expenditure.', 'What is our average turnaround?'];

export default function Page() {
  const [q, setQ] = useState('');
  const [history, setHistory] = useState<Array<{ q: string; a: Answer }>>([]);
  const ask = useAction(async (question: string) => {
    const a = await api.post<Answer>('/org/assistant', { question });
    setHistory((h) => [{ q: question, a }, ...h]);
    setQ('');
  });
  return (
    <>
      <PageHeader title="Analytics assistant" subtitle="Ask about your organisation's verifications. Answers come only from your data; the assistant never runs free-form SQL." />
      <Card>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (q) void ask.run(q); }}>
          <div style={{ flex: 1, minWidth: 240 }}><TextInput label="Your question" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Button type="submit" loading={ask.pending} style={{ alignSelf: 'flex-end' }}>Ask</Button>
        </form>
        <div className="row" style={{ marginTop: 10 }}>{EXAMPLES.map((e) => <button key={e} className="btn btn-ghost btn-sm" onClick={() => void ask.run(e)}>{e}</button>)}</div>
        <ErrorAlert error={ask.error} />
      </Card>
      {history.map((h, i) => (
        <Card key={i} title={<h3 style={{ margin: 0 }}>{h.q}</h3>} actions={<><Badge tone={h.a.interpretedBy === 'ai' ? 'info' : undefined}>{h.a.interpretedBy === 'ai' ? 'AI-interpreted' : 'Rule-interpreted'}</Badge><Badge>{humanize(h.a.intent)}</Badge></>}>
          <p>{h.a.answer}</p>
          {h.a.table?.length ? <DataTable<Record<string, unknown>> rows={h.a.table} rowKey={(r) => JSON.stringify(r)} columns={Object.keys(h.a.table[0]!).filter((k) => k !== 'id').map((k) => ({ key: k, header: humanize(k), render: (r) => String(r[k] ?? '—') }))} /> : null}
        </Card>
      ))}
    </>
  );
}
