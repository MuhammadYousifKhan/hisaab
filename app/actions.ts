'use server';
// Server actions. Every input is validated before anything is written; writes are append-only.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getConn } from '@/lib/db/client';
import { appendAction, createBook, dbReplay, dbTryEdit, dbTryUnbalanced, loadState } from '@/lib/db/store';
import { TODAY, tryUnbalanced } from '@/lib/engine';
import type { Action } from '@/lib/engine';

export type ReportState = { ok?: boolean; error?: 'eTid' | 'eAmt' | 'eOther'; n?: number };

const Report = z.object({
  bid: z.string().regex(/^B\d{2}$/),
  ch: z.enum(['EP', 'JC', 'CA', 'RA', 'BR']),
  amt: z.string().max(20),
  day: z.coerce.number().int().min(TODAY - 30).max(TODAY),
  tid: z.string().max(40),
});

export async function reportPayment(_prev: ReportState, fd: FormData): Promise<ReportState> {
  const p = Report.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: 'eOther' };
  const tid = p.data.tid.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,24}$/.test(tid)) return { error: 'eTid' };
  const v = Number(p.data.amt.replace(/[,\s]/g, ''));
  if (!Number.isFinite(v) || v <= 0 || v > 1_000_000) return { error: 'eAmt' };
  const L = await loadState();
  if (!L.S.bById.has(p.data.bid)) return { error: 'eOther' };
  const n = L.S.reports.length + 1;
  await appendAction(L.conn, L.book.id, { type: 'report', n, bid: p.data.bid, ch: p.data.ch, amount: Math.round(v * 100), day: p.data.day, tid });
  revalidatePath('/', 'layout');
  return { ok: true, n };
}

const Ops = z.object({
  type: z.enum(['apply', 'refund', 'accept_fee', 'claim', 'ack']),
  exId: z.string().min(3).max(80),
  bid: z.string().regex(/^B\d{2}$/).optional().or(z.literal('')),
});

export async function opsDecision(fd: FormData): Promise<void> {
  const p = Ops.safeParse(Object.fromEntries(fd));
  if (!p.success) redirect('/console?tab=queue&err=invalid');
  const { type, exId, bid } = p.data;
  const L = await loadState();
  const ex = L.S.exById.get(exId);
  if (!ex || ex.status === 'resolved') redirect('/console?tab=queue&err=stale');
  if (type === 'apply' && (!bid || !L.S.bById.has(bid))) redirect('/console?tab=queue&err=borrower');
  const action: Action = type === 'apply' ? { type, exId, bid: bid as string } : { type, exId };
  await appendAction(L.conn, L.book.id, action);
  const after = await loadState();
  const je = after.S.exById.get(exId)?.resolution?.je;
  revalidatePath('/', 'layout');
  redirect('/console?tab=queue&done=' + encodeURIComponent(je || type));
}

export type ProofResult = { ok: boolean; msg: string } | null;

export async function proofReplay(): Promise<ProofResult> {
  const L = await loadState();
  const r = await dbReplay(L);
  return {
    ok: r.dbInserted === 0 && r.engineAccepted === 0 && r.newEntries === 0,
    msg: 'Re-sent ' + r.sent + ' channel events and bank lines. Postgres inserted ' + r.dbInserted + ' new rows, the engine accepted ' + r.engineAccepted + ', and ' + r.newEntries + ' new journal entries were posted.',
  };
}

export async function proofUnbalanced(): Promise<ProofResult> {
  const L = await loadState();
  const e = tryUnbalanced(L.S);
  const d = await dbTryUnbalanced(L.conn, L.book.id);
  return { ok: e.ok && d.ok, msg: 'Engine: ' + e.msg + ' Postgres (bypassing the engine): ' + d.msg };
}

export async function proofEdit(): Promise<ProofResult> {
  const L = await loadState();
  return dbTryEdit(L.conn, L.book.id);
}

export async function newBook(fd: FormData): Promise<void> {
  const raw = String(fd.get('seed') ?? '').trim();
  const seed = raw === 'random' ? 1 + Math.floor(Math.random() * 99999) : Number(raw);
  if (!Number.isInteger(seed) || seed < 1 || seed > 2147483647) redirect('/proof?err=seed');
  const conn = await getConn();
  await createBook(conn, seed);
  revalidatePath('/', 'layout');
  redirect('/proof?fresh=' + seed);
}
