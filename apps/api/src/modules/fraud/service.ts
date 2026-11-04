import type { FraudSeverity } from '@avn/contracts';
import type { Tx } from '@avn/database';
import type { Signal } from './rules';

export interface SignalRow {
  requestId?: string;
  verifierId?: string;
  evidenceId?: string;
  rule: string;
  severity: FraudSeverity;
  score: number;
  explanation: string;
  data?: object;
}

export async function recordSignals(tx: Tx, rows: SignalRow[]): Promise<void> {
  if (rows.length) await tx.fraudSignal.createMany({ data: rows });
}

export const arrivalSignalsToRows = (signals: Signal[], requestId: string, verifierId: string): SignalRow[] =>
  signals.map((s) => ({ requestId, verifierId, rule: s.rule, severity: s.severity, score: s.score, explanation: s.explanation, data: (s.data ?? undefined) as object | undefined }));
