// One-click sandbox scenario. It opens four sandbox borrowers with loans and sends a set of sandbox transactions
// through the same intake as the webhooks and the bank feed: normal and exceptional payments, settlements, a reversal,
// a borrower's report. Then it reads the books back and checks that every exceptional state was handled as it should be.
// Everything lands in the live book like any other input, so its review items can be worked in the console.
import { randomInt } from 'node:crypto';
import { hashSecret } from '@/lib/auth/password';
import type { Conn } from '@/lib/db/client';
import { appendAction, appendBorrower, appendLoan, clockFor, currentBook, loadState } from '@/lib/db/store';
import { CH, normPhone, runChecks } from '@/lib/engine';
import type { PayCh, PayStatus } from '@/lib/engine';
import { ingestBank, ingestPayments } from '@/lib/ingest/ingest';
import { paymentPayload, reversalPayload } from '@/lib/ingest/payloads';

export const SANDBOX_PIN = '1234';
export interface SandboxStep { label: string; ok: boolean; detail: string }
export interface SandboxResult { tag: string; borrowers: { id: string; name: string; phone: string }[]; steps: SandboxStep[] }

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export async function runSandbox(conn: Conn, by: string): Promise<SandboxResult> {
  const book = await currentBook(conn);
  const clock = clockFor(book);
  const S0 = (await loadState({ conn, bookId: book.id })).S;
  const tag = Array.from({ length: 3 }, () => LETTERS[randomInt(LETTERS.length)]).join('');
  const usedPhones = new Set(S0.borrowers.map(b => normPhone(b.phone)));
  const usedTids = new Set(S0.txnList.map(t => t.tid));
  const phone = () => { let p: string; do { p = '03' + randomInt(40, 50) + String(randomInt(1000000, 10000000)); } while (usedPhones.has(p)); usedPhones.add(p); return p; };
  const tid = (ch: PayCh) => { let t: string; do { t = ch + (ch === 'CA' ? String(randomInt(100000, 1000000)) : String(randomInt(10000000, 100000000))); } while (usedTids.has(t)); usedTids.add(t); return t; };
  const at = (minsAgo: number) => ({ day: clock.day, min: Math.max(0, clock.min - minsAgo) });

  // Four applicants with thin files, each with a 12-week loan of Rs 12,000 + Rs 2,400 (Rs 1,200 a week).
  const pinHash = await hashSecret(SANDBOX_PIN);
  const people: { id: string; name: string; phone: string; loan: string }[] = [];
  for (const [first, ch] of [['Ali Raza', 'JC'], ['Sara Khan', 'EP'], ['Bilal Ahmed', 'RA'], ['Hina Baloch', 'CA']] as [string, PayCh][]) {
    const name = first + ' · sandbox ' + tag, ph = phone();
    const b = await appendBorrower(conn, book.id, { name, nameUr: '', phone: ph, work: 'Sandbox', workUr: '', city: 'Sukkur', ch }, pinHash, by);
    if ('error' in b) throw new Error('Could not open a sandbox borrower: ' + b.error);
    const l = await appendLoan(conn, book.id, { bid: b.id, principal: 1200000, fee: 240000, n: 12, firstDue: clock.day + 1 }, by);
    if ('error' in l) throw new Error('Could not issue a sandbox loan: ' + l.error);
    people.push({ id: b.id, name, phone: ph, loan: l.id });
  }
  const [ali, sara, bilal, hina] = people;
  const NAME = (p: { name: string }) => p.name.toUpperCase();
  const pay = (ch: PayCh, id: string, amount: number, o: { phone?: string | null; name?: string; ref?: string; status?: PayStatus; minsAgo?: number; day?: number; failReason?: string } = {}) => {
    const t = o.day !== undefined ? { day: o.day, min: 600 } : at(o.minsAgo ?? 0);
    return { ch, payload: paymentPayload({ ch, tid: id, amount, phone: o.phone ?? null, name: o.name ?? '', ref: o.ref ?? '', status: o.status ?? 'success', day: t.day, min: t.min, failReason: o.failReason }) };
  };

  const T = {
    normal: tid('JC'), twice: tid('JC'), failed: tid('JC'), partial: tid('EP'), over: tid('EP'), stranger: tid('JC'),
    wrongRef: tid('RA'), pending: tid('RA'), agent: tid('CA'), lateAgent: tid('CA'), broken: tid('EP'),
  };
  const normal = pay('JC', T.normal, 120000, { phone: ali.phone, name: NAME(ali), minsAgo: 40 });
  const r1 = await ingestPayments([
    normal,
    normal, // the same payment delivered again
    pay('JC', T.twice, 120000, { phone: ali.phone, name: NAME(ali), minsAgo: 37 }),
    pay('JC', T.failed, 120000, { phone: ali.phone, name: NAME(ali), status: 'failed', failReason: 'Insufficient wallet balance', minsAgo: 35 }),
    pay('EP', T.partial, 60000, { phone: sara.phone, name: NAME(sara), minsAgo: 34 }),
    pay('EP', T.over, 90000, { phone: sara.phone, name: NAME(sara), minsAgo: 30 }),
    pay('JC', T.stranger, 120000, { phone: phone(), name: 'RUBINA BIBI', ref: 'silai', minsAgo: 28 }),
    pay('RA', T.wrongRef, 120000, { name: NAME(bilal), ref: ali.loan + ' qist', minsAgo: 25 }),
    pay('RA', T.pending, 120000, { name: NAME(bilal), ref: bilal.loan, status: 'pending', minsAgo: 20 }),
    pay('CA', T.agent, 120000, { name: NAME(hina), ref: hina.loan, minsAgo: 18 }),
    // An agent file arriving three days late with a collection nobody can identify: that day's cash never reached the bank.
    pay('CA', T.lateAgent, 50000, { name: 'UNKNOWN CUSTOMER', day: clock.day - 3 }),
    { ch: 'EP' as PayCh, payload: { event: 'payment.completed', txn_id: T.broken, account_name: 'X', amount_pkr: 'twelve hundred' } },
    { ch: 'EP' as PayCh, payload: reversalPayload(T.partial, 'Disputed by account holder', at(10).day, at(10).min) },
  ], conn);
  const res = (i: number) => r1.results[i]?.status;

  // The borrower whose payment came from a relative's phone reports it from her app.
  let S = (await loadState({ conn, bookId: book.id })).S;
  await appendAction(conn, book.id, { type: 'report', n: S.reports.length + 1, bid: hina.id, ch: 'JC', amount: 120000, day: clock.day, tid: T.stranger });

  // The bank: a Raast credit, a cash deposit nobody reported (sent twice), and each channel's settlement for the day.
  const key = (k: string) => 'sandbox:' + tag + ':' + k;
  await ingestBank([{ day: clock.day, min: clock.min, amount: 120000, ref: 'RAAST-' + T.wrongRef, narration: 'RAAST CR ' + T.wrongRef, key: key('raast'), source: 'Sandbox (bank)' }], conn);
  const deposit = { day: clock.day, min: clock.min, amount: 150000, ref: '', narration: 'CASH DEPOSIT BR-0412 SUKKUR', key: key('deposit'), source: 'Sandbox (bank)' };
  const d1 = await ingestBank([deposit], conn);
  const d2 = await ingestBank([deposit], conn);
  S = (await loadState({ conn, bookId: book.id })).S;
  const settle = async (sample: string, diff: number) => {
    const b = S.batches.get(S.txns.get(sample)?.batchId ?? '');
    if (!b || b.settled) return null;
    const fee = Math.round((b.gross * CH[b.ch].bps) / 10000);
    await ingestBank([{ day: clock.day, min: clock.min, amount: b.gross - fee - b.clawback - diff, ref: b.id, narration: CH[b.ch].name.toUpperCase() + ' SETTLEMENT', key: key('settle:' + b.id), source: 'Sandbox (bank)' }], conn);
    return b.id;
  };
  const jcBatch = await settle(T.normal, 15000); // Rs 150 short
  const epBatch = await settle(T.over, -5000); // Rs 50 over
  const caBatch = await settle(T.agent, 0); // exact
  const L = await loadState({ conn, bookId: book.id });
  S = L.S;

  // Read the books back and check each state.
  const tx = (t: string) => S.txns.get(t);
  const ex = (id: string) => S.exById.get(id);
  const entry = (t: string, reason: string) => S.ledger.entries.some(e => e.src[0] === t && e.reason === reason);
  const lateBatch = tx(T.lateAgent)?.batchId ?? '';
  const report = S.reports.find(r => r.reportedTid === T.stranger);
  const steps: SandboxStep[] = [
    { label: 'Normal payment matched by phone and settled', ok: tx(T.normal)?.state === 'applied' && tx(T.normal)?.rule === 'R2' && !!tx(T.normal)?.settled, detail: T.normal },
    { label: 'Same payment delivered twice: stored once, ignored', ok: res(1) === 'duplicate' && S.txnList.filter(t => t.tid === T.normal).length === 1, detail: T.normal },
    { label: 'Paid twice within minutes: held for review', ok: !!ex('EX-DUP-' + T.twice), detail: 'EX-DUP-' + T.twice },
    { label: 'Failed payment: tracked, nothing posted', ok: tx(T.failed)?.state === 'failed' && tx(T.failed)?.entries.length === 0, detail: T.failed },
    { label: 'Partial payment: applied, rest still due', ok: entry(T.partial, 'PARTIAL_PAYMENT'), detail: T.partial },
    { label: 'Overpayment: extra saved as credit', ok: entry(T.over, 'OVERPAYMENT_CREDIT'), detail: T.over },
    { label: 'Reversed by the channel: mirror entry, installment reopened', ok: tx(T.partial)?.state === 'reversed' && !!ex('EX-REV-' + T.partial), detail: 'EX-REV-' + T.partial },
    { label: 'Paid from an unknown phone: held in suspense', ok: tx(T.stranger)?.state === 'held' && !!ex('EX-ORP-' + T.stranger), detail: 'EX-ORP-' + T.stranger },
    { label: 'Borrower reported it: linked to the held payment', ok: report?.finding === 'held' && report.linked === 'EX-ORP-' + T.stranger, detail: report?.id ?? '' },
    { label: 'Reference points to another loan: held', ok: !!ex('EX-REF-' + T.wrongRef), detail: 'EX-REF-' + T.wrongRef },
    { label: 'Transfer still pending: memo only, nothing posted', ok: tx(T.pending)?.state === 'pending' && tx(T.pending)?.entries.length === 0, detail: T.pending },
    { label: 'Malformed payload: stored and quarantined, not dropped', ok: res(11) === 'quarantined' && S.quarantined.some(q => q.re.tid === T.broken), detail: T.broken },
    { label: 'Bank deposit with no record: held', ok: !!d1.results[0].id && !!ex('EX-UNX-' + d1.results[0].id), detail: 'EX-UNX-' + (d1.results[0].id ?? '') },
    { label: 'Same bank line sent again: added nothing', ok: d2.results[0].duplicate, detail: deposit.narration },
    { label: 'Settlement Rs 150 short: gap booked as a claim', ok: !!jcBatch && !!ex('EX-SHT-' + jcBatch), detail: jcBatch ?? '—' },
    { label: 'Settlement Rs 50 over: extra held in suspense', ok: !!epBatch && !!ex('EX-OVR-' + epBatch), detail: epBatch ?? '—' },
    { label: 'Exact settlement matched to its bank line', ok: !!caBatch && S.batches.get(caBatch)?.settled === true && S.batches.get(caBatch)?.diff === 0, detail: caBatch ?? '—' },
    { label: 'Settlement never arrived: flagged after two days', ok: !!ex('EX-MIS-' + lateBatch), detail: 'EX-MIS-' + lateBatch },
    { label: 'Every ledger check still passes', ok: runChecks(S).every(c => c.pass), detail: S.ledger.entries.length + ' entries' },
  ];
  return { tag, borrowers: people.map(p => ({ id: p.id, name: p.name, phone: p.phone })), steps };
}
