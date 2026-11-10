'use server';
// Server actions. Each one checks who is calling (they are public endpoints), validates every input,
// and writes append-only.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { actorName, getSession, loadView, requireOps } from '@/lib/auth/viewer';
import { appendAction, dbReplay, dbTryEdit, dbTryUnbalanced, loadState } from '@/lib/db/store';
import { claimLeft, tryUnbalanced } from '@/lib/engine';
import type { Action } from '@/lib/engine';

const BookId = z.coerce.number().int().positive();
const Bid = z.string().regex(/^B\d{2,4}$/);

export type ReportState = { ok?: boolean; error?: 'eTid' | 'eAmt' | 'eOther'; n?: number };

const Report = z.object({
  bid: Bid, ch: z.enum(['EP', 'JC', 'CA', 'RA', 'BR']), amt: z.string().max(20), day: z.coerce.number().int(), tid: z.string().max(40),
});

/** A borrower reports a payment the lender hasn't matched. Staff may file one on a borrower's behalf. */
export async function reportPayment(_prev: ReportState, fd: FormData): Promise<ReportState> {
  const session = await getSession();
  if (!session) return { error: 'eOther' };
  const p = Report.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: 'eOther' };
  // A borrower can only ever report for themselves, in their own book, whatever the form says.
  const bid = session.role === 'borrower' ? session.bid : p.data.bid;
  const bookId = session.role === 'borrower' ? session.bookId : BookId.safeParse(fd.get('bookId')).data;
  if (!bookId) return { error: 'eOther' };
  const L = await loadState({ bookId });
  const tid = p.data.tid.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,24}$/.test(tid)) return { error: 'eTid' };
  const v = Number(p.data.amt.replace(/[,\s]/g, ''));
  if (!Number.isFinite(v) || v <= 0 || v > 1_000_000) return { error: 'eAmt' };
  if (p.data.day < L.S.today - 30 || p.data.day > L.S.today) return { error: 'eOther' };
  if (!L.S.bById.has(bid)) return { error: 'eOther' };
  const n = L.S.reports.length + 1;
  await appendAction(L.conn, L.book.id, { type: 'report', n, bid, ch: p.data.ch, amount: Math.round(v * 100), day: p.data.day, tid });
  revalidatePath('/', 'layout');
  return { ok: true, n };
}

const Ops = z.object({
  type: z.enum(['apply', 'refund', 'accept_fee', 'claim', 'ack', 'return', 'recover', 'paid']),
  exId: z.string().min(3).max(80),
  bid: Bid.optional().or(z.literal('')),
  claim: z.string().max(80).optional().or(z.literal('')),
  // The staff member's own reason, kept with the decision; and, for a payout, its reference.
  note: z.string().trim().max(200).optional(),
  ref: z.string().trim().max(60).optional(),
  bookId: BookId,
});

export async function opsDecision(fd: FormData): Promise<void> {
  const s = await requireOps('/console?tab=queue');
  const p = Ops.safeParse(Object.fromEntries(fd));
  if (!p.success) redirect('/console?tab=queue&err=invalid');
  const { type, exId, bid, claim, bookId } = p.data;
  const L = await loadState({ bookId });
  const ex = L.S.exById.get(exId);
  if (!ex || ex.status === 'resolved') redirect('/console?tab=queue&err=stale');
  if (type === 'apply' && (!bid || !L.S.bById.has(bid))) redirect('/console?tab=queue&err=borrower');
  if (type === 'recover') {
    const c = claim ? L.S.exById.get(claim) : undefined;
    if (!c || c.kind !== 'settlement_short' || c.status === 'resolved') redirect('/console?tab=queue&err=claim');
    if (ex.amount > claimLeft(c)) redirect('/console?tab=queue&err=toomuch');
  }
  if (type === 'paid' && ex.kind !== 'refund_payable') redirect('/console?tab=queue&err=invalid');
  const by = actorName(s);
  const extra = { by, ...(p.data.note ? { note: p.data.note } : {}) };
  const action: Action = type === 'apply' ? { type, exId, bid: bid as string, ...extra }
    : type === 'recover' ? { type, exId, claim: claim as string, ...extra }
    : type === 'paid' ? { type, exId, ...(p.data.ref ? { ref: p.data.ref } : {}), ...extra }
    : { type, exId, ...extra };
  await appendAction(L.conn, L.book.id, action);
  const after = await loadState({ bookId });
  const je = after.S.exById.get(exId)?.resolution?.je;
  revalidatePath('/', 'layout');
  redirect('/console?tab=queue&done=' + encodeURIComponent(je || type));
}

export type ProofResult = { ok: boolean; msg: string } | null;

// The proof trials are open to visitors: they only re-send stored files or attempt writes the database refuses.
export async function proofReplay(): Promise<ProofResult> {
  const L = await loadView();
  const r = await dbReplay(L);
  return {
    ok: r.dbInserted === 0 && r.engineAccepted === 0 && r.newEntries === 0,
    msg: 'Re-sent ' + r.sent + ' channel events and bank lines. Postgres inserted ' + r.dbInserted + ' new rows, the engine accepted ' + r.engineAccepted + ', and ' + r.newEntries + ' new journal entries were posted.',
  };
}

export async function proofUnbalanced(): Promise<ProofResult> {
  const L = await loadView();
  const e = tryUnbalanced(L.S);
  const d = await dbTryUnbalanced(L.conn, L.book.id, L.S.today);
  return { ok: e.ok && d.ok, msg: 'Engine: ' + e.msg + ' Postgres (bypassing the engine): ' + d.msg };
}

export async function proofEdit(): Promise<ProofResult> {
  const L = await loadView();
  return dbTryEdit(L.conn, L.book.id);
}
