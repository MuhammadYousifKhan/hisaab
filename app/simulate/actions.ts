'use server';
// The channel simulator: stands in for JazzCash, Easypaisa, Raast, the agent network and the bank, so the live
// book can be exercised without real providers. It builds the same payloads a channel would send and pushes them
// through the same ingest path as the webhooks. Staff only, live book only.
import { randomInt } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { actorName, requireOps } from '@/lib/auth/viewer';
import { getConn } from '@/lib/db/client';
import { advanceClock, clockFor, currentBook, loadState } from '@/lib/db/store';
import { CH } from '@/lib/engine';
import type { PayCh } from '@/lib/engine';
import { ingestBank, ingestPayments } from '@/lib/ingest/ingest';
import { paymentPayload, reversalPayload } from '@/lib/ingest/payloads';
import { runSandbox, type SandboxResult } from '@/lib/sandbox';

export type SimState = { ok?: string; error?: string; payload?: string };

const Send = z.object({
  ch: z.enum(['EP', 'JC', 'CA', 'RA']),
  bid: z.string().regex(/^(B\d{2,4}|unknown)$/),
  amount: z.coerce.number().positive('Enter an amount').max(1_000_000),
  status: z.enum(['success', 'failed', 'pending']),
  ref: z.string().trim().max(60).default(''),
  phone: z.string().trim().max(20).default(''),
  name: z.string().trim().max(60).default(''),
  minsAgo: z.coerce.number().int().min(0).max(600).default(0),
});

const newTid = (ch: PayCh) => ch + (ch === 'CA' ? String(randomInt(100000, 999999)) : String(randomInt(10000000, 99999999)));

export async function simSend(_prev: SimState, fd: FormData): Promise<SimState> {
  await requireOps('/simulate');
  const p = Send.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Check the form.' };
  const conn = await getConn();
  const book = await currentBook(conn);
  const L = await loadState({ conn, bookId: book.id });
  const b = p.data.bid === 'unknown' ? null : L.S.bById.get(p.data.bid);
  if (p.data.bid !== 'unknown' && !b) return { error: 'That borrower is not in the live book.' };
  const amount = Math.round(p.data.amount * 100);
  const { day, min } = clockFor(book);
  const at = Math.max(0, min - p.data.minsAgo);
  const walletish = p.data.ch === 'EP' || p.data.ch === 'JC';
  const tid = newTid(p.data.ch);
  const phone = walletish ? (p.data.phone || (b ? b.phone : '03' + randomInt(10, 49) + randomInt(1000000, 9999999))) : null;
  const name = p.data.name || (b ? b.name.toUpperCase() : 'GHULAM MUSTAFA');
  const ref = p.data.ref || (b && !walletish ? (b.loanId ?? '') : '');
  const payload = paymentPayload({ ch: p.data.ch, tid, amount, phone, name, ref, status: p.data.status, day, min: at });
  const { results } = await ingestPayments([{ ch: p.data.ch, payload }], conn);
  const bank = p.data.ch === 'RA' && p.data.status === 'success'
    ? await ingestBank([{ day, min: Math.min(at + 2, 1439), amount, ref: 'RAAST-' + tid, narration: 'RAAST CR ' + tid + ' ' + name, key: 'sim:raast:' + tid, source: 'Simulator (bank)' }], conn)
    : null;
  revalidatePath('/', 'layout');
  const r = results[0];
  return {
    ok: CH[p.data.ch].name + ' ' + tid + ' sent: ' + r.status + (bank ? '. Its Raast credit also reached the bank.' : '.'),
    error: r.status === 'quarantined' ? r.error : undefined,
    payload: JSON.stringify(payload, null, 2),
  };
}

export async function simReverse(_prev: SimState, fd: FormData): Promise<SimState> {
  await requireOps('/simulate');
  const p = z.object({ tid: z.string().min(4).max(40), reason: z.string().trim().min(2).max(80) }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: 'Choose a payment and give a reason.' };
  const conn = await getConn();
  const book = await currentBook(conn);
  const L = await loadState({ conn, bookId: book.id });
  const t = L.S.txns.get(p.data.tid);
  if (!t || t.ch === 'BR') return { error: 'No channel payment with that ID.' };
  if (t.state === 'reversed' || t.state === 'failed' || t.state === 'pending') return { error: 'A ' + t.state + ' payment cannot be reversed.' };
  const { day, min } = clockFor(book);
  const payload = reversalPayload(t.tid, p.data.reason, day, min);
  const { results } = await ingestPayments([{ ch: t.ch as PayCh, payload }], conn);
  revalidatePath('/', 'layout');
  return { ok: CH[t.ch].name + ' reversed ' + t.tid + ': ' + results[0].status + '.', payload: JSON.stringify(payload, null, 2) };
}

export async function simSettle(_prev: SimState, fd: FormData): Promise<SimState> {
  await requireOps('/simulate');
  const p = z.object({ batch: z.string().min(5).max(60), short: z.coerce.number().min(-100000).max(100000).default(0) }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: 'Choose a batch.' };
  const conn = await getConn();
  const book = await currentBook(conn);
  const L = await loadState({ conn, bookId: book.id });
  const b = L.S.batches.get(p.data.batch);
  if (!b || b.ch === 'RA') return { error: 'No such channel batch.' };
  if (b.settled) return { error: b.id + ' has already settled.' };
  const net = b.gross - b.clawback;
  if (net <= 0) return { error: 'This batch has nothing to pay out: its payments were all reversed.' };
  const fee = Math.round((b.gross * CH[b.ch].bps) / 10000);
  const amount = net - fee - Math.round(p.data.short * 100);
  if (amount <= 0) return { error: 'That shortfall is larger than the whole settlement.' };
  const { day, min } = clockFor(book);
  const { results } = await ingestBank([{ day, min, amount, ref: b.id, narration: CH[b.ch].name.toUpperCase() + ' SETTLEMENT ' + b.id.slice(8, 18), key: 'sim:settle:' + b.id, source: 'Simulator (bank)' }], conn);
  revalidatePath('/', 'layout');
  // The batch row disappears once it settles, so the confirmation travels in the address instead of component state.
  redirect('/simulate?ok=' + encodeURIComponent(b.id + ' paid out ' + (amount / 100).toLocaleString('en-US') + (p.data.short ? ' (' + p.data.short + ' ' + (p.data.short > 0 ? 'short' : 'over') + ')' : '') + (results[0].duplicate ? ', already on file' : '') + '.'));
}

export async function simAdvance(_prev: SimState, fd: FormData): Promise<SimState> {
  await requireOps('/simulate');
  const days = Number(fd.get('days') ?? 1);
  const conn = await getConn();
  const book = await currentBook(conn);
  try { await advanceClock(conn, book.id, days); } catch (e) { return { error: e instanceof Error ? e.message : 'Could not move the clock.' }; }
  revalidatePath('/', 'layout');
  return { ok: 'Moved the live book forward ' + days + ' day' + (days === 1 ? '' : 's') + '. Installments due in between are now processed.' };
}

export type SandboxState = { error?: string; result?: SandboxResult };

/** Run the whole sandbox scenario: every exceptional state, through the real intake, then checked. */
export async function simSandbox(): Promise<SandboxState> {
  const s = await requireOps('/simulate');
  try {
    const result = await runSandbox(await getConn(), actorName(s));
    revalidatePath('/', 'layout');
    return { result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'The sandbox scenario could not run.' };
  }
}

/** A channel sends a payment it already sent (a webhook retry). */
export async function simRepeat(_prev: SimState, fd: FormData): Promise<SimState> {
  await requireOps('/simulate');
  const id = String(fd.get('raw') ?? '');
  const conn = await getConn();
  const L = await loadState({ conn });
  const re = L.S.raw.find(r => r.id === id);
  if (!re) return { error: 'Choose a payment to send again.' };
  const { results } = await ingestPayments([{ ch: re.ch, payload: re.payload }], conn);
  revalidatePath('/', 'layout');
  return { ok: re.tid + ' delivered again: ' + (results[0].status === 'duplicate' ? 'recognised as a repeat, nothing applied twice.' : results[0].status + '.') };
}

/** A channel sends a payload that fails validation. */
export async function simBroken(_prev: SimState, fd: FormData): Promise<SimState> {
  await requireOps('/simulate');
  const ch = (['EP', 'JC', 'CA', 'RA'] as const).find(c => c === fd.get('ch')) ?? 'JC';
  const book = await currentBook(await getConn());
  const { day, min } = clockFor(book);
  const payload = paymentPayload({ ch, tid: newTid(ch), amount: 120000, phone: null, name: 'UNKNOWN', ref: '', status: 'success', day, min });
  payload[ch === 'EP' ? 'amount_pkr' : 'amount'] = 'twelve hundred';
  const { results } = await ingestPayments([{ ch, payload }]);
  revalidatePath('/', 'layout');
  return { ok: CH[ch].name + ' payload ' + results[0].status + (results[0].error ? ': ' + results[0].error : '') + '. It is stored, never dropped.', payload: JSON.stringify(payload, null, 2) };
}

/** Money reaches the bank with no channel record (e.g. a cash deposit at a branch). */
export async function simDeposit(_prev: SimState, fd: FormData): Promise<SimState> {
  await requireOps('/simulate');
  const p = z.object({ amount: z.coerce.number().positive('Enter an amount').max(1_000_000), narration: z.string().trim().min(2, 'Enter the bank narration').max(120) }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Check the form.' };
  const book = await currentBook(await getConn());
  const { day, min } = clockFor(book);
  const { results } = await ingestBank([{ day, min, amount: Math.round(p.data.amount * 100), ref: '', narration: p.data.narration, key: 'sim:deposit:' + randomInt(1e9), source: 'Simulator (bank)' }]);
  revalidatePath('/', 'layout');
  return { ok: 'Deposit ' + results[0].id + ' reached the bank with no payment record. It is held for review.' };
}
