// Turning uploaded files into inputs: agent-network CSVs into channel payloads (stored as received), and bank
// statements into bank lines with a dedupe key, so the same statement can be uploaded twice safely.
import { createHash } from 'node:crypto';
import { dayFromIso, minFromHhmm, toPaisa } from '@/lib/engine';
import type { BankIn } from '@/lib/db/store';
import { csvRecords } from './csv';

export interface RowError { line: number; error: string }

/** Agent CSV rows become payloads exactly as written; the adapter validates them later, like any channel. */
export function agentRows(text: string): { payloads: Record<string, unknown>[]; errors: RowError[]; header: string[] } {
  const { header, rows } = csvRecords(text);
  const missing = ['receipt_no', 'amount', 'status'].filter(c => !header.includes(c));
  if (missing.length) return { payloads: [], errors: [{ line: 1, error: 'Missing column' + (missing.length > 1 ? 's' : '') + ': ' + missing.join(', ') }], header };
  return { payloads: rows.map(r => r.values), errors: [], header };
}

const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;
/** Parse a credit amount like "3,500.00". Debits (negative, or a Dr/debit marker) are refused. */
export function creditPaisa(raw: string): number | null {
  const v = raw.replace(/[,\s]/g, '').replace(/^(rs\.?|pkr)/i, '');
  if (!AMOUNT.test(v)) return null;
  const p = toPaisa(v);
  return p > 0 ? p : null;
}

export interface BankRowIn { date: string; time?: string; amount: string | number; narration: string; ref?: string; bank_ref?: string; type?: string }

/** Bank statement lines (CSV rows or JSON objects) to stored bank lines. Only credits are taken. */
export function bankLinesFrom(rows: { line: number; values: BankRowIn }[], source: string): { lines: BankIn[]; errors: RowError[] } {
  const lines: BankIn[] = [], errors: RowError[] = [];
  const seen = new Map<string, number>();
  for (const { line, values: v } of rows) {
    const day = dayFromIso(String(v.date ?? ''));
    if (day === null) { errors.push({ line, error: 'date must look like 2026-11-09' }); continue; }
    const t = String(v.time ?? '').trim();
    const min = t ? minFromHhmm(t) : null;
    if (t && min === null) { errors.push({ line, error: 'time must look like 09:30' }); continue; }
    if (/^(dr|debit)$/i.test(String(v.type ?? '').trim()) || String(v.amount).trim().startsWith('-')) { errors.push({ line, error: 'debit lines are not payments, skipped' }); continue; }
    const amount = creditPaisa(String(v.amount ?? ''));
    if (amount === null) { errors.push({ line, error: 'amount must be a positive number like 3500 or 3,500.00' }); continue; }
    const narration = String(v.narration ?? '').trim().slice(0, 200);
    const ref = String(v.ref ?? '').trim().slice(0, 80);
    const bankRef = String(v.bank_ref ?? '').trim().slice(0, 80);
    let key: string;
    if (bankRef) key = 'ref:' + bankRef;
    else {
      // Identical lines on one statement are real (two equal deposits), so the n-th copy gets its own key.
      const h = createHash('sha256').update([day, amount, narration, ref].join('|')).digest('hex').slice(0, 24);
      const n = (seen.get(h) ?? 0) + 1;
      seen.set(h, n);
      key = 'h:' + h + ':' + n;
    }
    lines.push({ day, min, amount, narration, ref, key, source });
  }
  return { lines, errors };
}

export function bankRowsFromCsv(text: string): { rows: { line: number; values: BankRowIn }[]; errors: RowError[] } {
  const { header, rows } = csvRecords(text);
  const alias = (r: Record<string, string>): BankRowIn => ({
    date: r.date ?? r.value_date ?? r.posting_date ?? '', time: r.time ?? '', amount: r.amount ?? r.credit ?? '',
    narration: r.narration ?? r.description ?? r.details ?? '', ref: r.ref ?? r.reference ?? '', bank_ref: r.bank_ref ?? r.transaction_id ?? r.txn_id ?? '', type: r.type ?? '',
  });
  const has = (...cs: string[]) => cs.some(c => header.includes(c));
  const missing = [has('date', 'value_date', 'posting_date') ? '' : 'date', has('amount', 'credit') ? '' : 'amount'].filter(Boolean);
  if (missing.length) return { rows: [], errors: [{ line: 1, error: 'Missing column' + (missing.length > 1 ? 's' : '') + ': ' + missing.join(', ') }] };
  return { rows: rows.map(r => ({ line: r.line, values: alias(r.values) })), errors: [] };
}
