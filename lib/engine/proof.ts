// Ledger proof: invariant checks recomputed from scratch.
import { CLEARING } from './data';
import { explain } from './explain';
import type { BankLine, Entry, ExKind, Exception, RawEvent, State, Txn, TxnState } from './types';
import { fmtRs } from './util';

export interface Check { title: string; detail: string; pass: boolean; value: string }

export function runChecks(S: State): Check[] {
  const L = S.ledger, E = L.entries, out: Check[] = [];
  const unbal = E.filter(e => e.lines.reduce((s, l) => s + l.dr, 0) !== e.lines.reduce((s, l) => s + l.cr, 0)).length;
  out.push({ title: 'Every journal entry balances', detail: E.length + ' entries checked one by one: debits equal credits in each.', pass: unbal === 0, value: unbal ? unbal + ' failing' : E.length + ' / ' + E.length });

  let tb = 0;
  for (const v of L.bal.values()) tb += v;
  out.push({ title: 'Trial balance is zero', detail: 'All debits minus all credits, across every account.', pass: tb === 0, value: fmtRs(tb) });

  const re = new Map<string, number>();
  for (const e of E) for (const l of e.lines) { const k = l.acct + '|' + (l.sub || ''); re.set(k, (re.get(k) || 0) + l.dr - l.cr); }
  const keys = new Set([...re.keys(), ...L.bal.keys()]);
  let mism = 0;
  for (const k of keys) if ((re.get(k) || 0) !== (L.bal.get(k) || 0)) mism++;
  out.push({ title: 'Replaying the journal rebuilds every balance', detail: 'Rebuilt ' + keys.size + ' account balances from the entries alone and compared them with the live ones.', pass: mism === 0, value: mism ? mism + ' differ' : '0 differences' });

  let bad = 0;
  for (const b of S.borrowers) {
    const led = L.balance('1200', b.id);
    const sch = S.insts.filter(i => i.bid === b.id).reduce((s, i) => s + i.amount - i.paid, 0);
    if (led !== sch) bad++;
  }
  out.push({ title: 'Each borrower’s schedule agrees with the ledger', detail: 'Unpaid amount on the installment schedule equals the borrower’s loan balance, for every borrower.', pass: bad === 0, value: S.borrowers.length - bad + ' / ' + S.borrowers.length });

  const clr = CLEARING.reduce((s, a) => s + L.balance(a), 0);
  let unsettled = 0;
  for (const b of S.batches.values()) if (!b.settled) unsettled += b.gross - b.clawback;
  out.push({ title: 'Money in transit equals unsettled channel payments', detail: 'Clearing balances in the ledger compared with payments the channels have not paid out yet (' + fmtRs(unsettled) + ').', pass: clr === unsettled, value: fmtRs(clr) });

  const noExp = E.filter(e => { const s = explain(e, 'en'); return !e.reason || !s || /undefined|NaN|\{/.test(s); }).length;
  out.push({ title: 'Every entry has a reason and a plain explanation', detail: 'Reason code present, and the sentence generated from its numbers has no gaps.', pass: noExp === 0, value: E.length - noExp + ' / ' + E.length });

  const st: Record<string, number> = {};
  let untracked = 0;
  for (const t of S.txnList) {
    const k = t.state || 'none';
    st[k] = (st[k] || 0) + 1;
    if (t.state === 'held') { const ex = t.exId ? S.exById.get(t.exId) : undefined; if (!ex || ex.status === 'resolved') untracked++; }
    if (!t.state || !['applied', 'held', 'failed', 'pending', 'reversed', 'refund_due', 'refunded'].includes(t.state)) untracked++;
  }
  const inputs = S.raw.length + S.bank.length;
  const accounted = inputs === S.accepted + S.ignored.length;
  const q = S.quarantined.length;
  out.push({
    title: 'No payment is silently dropped',
    detail: S.txnList.length + ' payments: ' + (st.applied || 0) + ' applied, ' + (st.held || 0) + ' held for review, ' + (st.failed || 0) + ' failed, ' + (st.pending || 0) + ' pending, ' + (st.reversed || 0) + ' reversed, ' + (st.refund_due || 0) + ' refund due, ' + (st.refunded || 0) + ' refunded. ' + S.ignored.length + ' repeat deliveries logged and ignored' + (q ? ', ' + q + ' malformed payloads quarantined' : '') + '.',
    pass: untracked === 0 && accounted, value: untracked ? untracked + ' untracked' : inputs + ' inputs accounted',
  });

  // Control accounts: each balance must be explained, to the paisa, by items that are still open.
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const held = sum(S.txnList.filter(t => t.state === 'held').map(t => t.amount));
  const overHeld = sum(S.exceptions.filter(e => e.kind === 'settlement_over' && !['return', 'recover'].includes(e.resolution?.action ?? '')).map(e => e.amount));
  const susp = -L.balance('2100');
  out.push({
    title: 'Suspense holds only money still being checked',
    detail: 'Suspense (' + fmtRs(susp) + ') equals payments held for review (' + fmtRs(held) + ') plus over-settlements not yet returned or offset (' + fmtRs(overHeld) + ').',
    pass: susp === held + overHeld, value: susp === held + overHeld ? 'fully explained' : fmtRs(susp - held - overHeld) + ' unexplained',
  });
  const claimsOpen = sum(S.exceptions.filter(e => e.kind === 'settlement_short' && e.status !== 'resolved').map(e => e.amount - (e.recovered || 0)));
  const claims = L.balance('1300');
  out.push({
    title: 'Claims on channels match open shortfalls',
    detail: 'Claims on channels (' + fmtRs(claims) + ') equal the shortfalls still open, less what channels have paid back (' + fmtRs(claimsOpen) + ').',
    pass: claims === claimsOpen, value: claims === claimsOpen ? 'fully explained' : fmtRs(claims - claimsOpen) + ' unexplained',
  });
  const owed = sum(S.exceptions.filter(e => e.kind === 'refund_payable' && e.status !== 'resolved').map(e => e.amount));
  const payable = -L.balance('2200');
  out.push({
    title: 'Refunds payable match refunds not yet paid out',
    detail: 'Refunds payable (' + fmtRs(payable) + ') equal refunds and channel returns decided but not yet paid (' + fmtRs(owed) + ').',
    pass: payable === owed, value: payable === owed ? 'fully explained' : fmtRs(payable - owed) + ' unexplained',
  });

  const fc = E.filter(e => /FORECAST|PROJECT/.test(e.reason)).length;
  out.push({ title: 'Projections never enter the ledger', detail: 'Actual figures read only posted entries. Projections come from a separate function that has no access to post().', pass: fc === 0, value: fc + ' projected entries' });

  const nonInt = E.filter(e => e.lines.some(l => !Number.isInteger(l.dr) || !Number.isInteger(l.cr))).length;
  out.push({ title: 'Every amount is whole paisa', detail: 'No floating-point money anywhere in the journal.', pass: nonInt === 0, value: nonInt ? nonInt + ' bad' : 'integers only' });
  return out;
}

/** Tries to post an unbalanced entry through the engine's guard. Nothing is written if it is rejected. */
export function tryUnbalanced(S: State): { ok: boolean; msg: string } {
  const before = S.ledger.entries.length;
  try {
    S.ledger.post({ day: S.today, reason: 'TEST_UNBALANCED', lines: [{ acct: '1000', dr: 1000000 }, { acct: '2100', cr: 990000 }], actor: 'proof: test' });
    return { ok: false, msg: 'The ledger accepted an unbalanced entry. This is a bug.' };
  } catch (err) {
    return { ok: S.ledger.entries.length === before, msg: err instanceof Error ? err.message : String(err) };
  }
}

/* ---------------- Traceability ---------------- */
const isRaw = (x: RawEvent | BankLine): x is RawEvent => 'tid' in x;

/** Every entry, payment, settlement, bank line and decision can be followed back to what caused it. */
export function traceChecks(S: State): Check[] {
  const E = S.ledger.entries, out: Check[] = [];
  const byId = new Map(E.map(e => [e.id, e]));

  const known = new Set<string>([
    ...S.loans.map(l => l.id), ...S.txns.keys(), ...S.batches.keys(), ...S.insts.map(i => i.id), ...S.exById.keys(),
    ...S.rawById.keys(), ...S.bankById.keys(), ...E.map(e => e.id),
  ]);
  const loose = E.filter(e => !e.src.length || e.src.some(id => !known.has(id))).length;
  out.push({
    title: 'Every journal entry points back to what caused it',
    detail: 'Each entry lists its sources (a loan, a payment, the payload or bank line as received, a settlement batch or a review item) and every one of them is on file.',
    pass: loose === 0, value: loose ? loose + ' with a missing source' : E.length + ' / ' + E.length,
  });

  let moved = 0, broken = 0;
  for (const t of S.txnList) {
    if (!S.rawById.has(t.rawId) && !S.bankById.has(t.rawId)) { broken++; continue; }
    if (t.state === 'failed' || t.state === 'pending') { if (t.entries.length) broken++; continue; }
    moved++;
    const first = t.entries.length ? byId.get(t.entries[0]) : undefined;
    if (!first || !first.src.includes(t.rawId) || t.entries.some(id => !byId.has(id))) broken++;
  }
  out.push({
    title: 'Every payment leads from what the channel sent to the ledger',
    detail: moved + ' payments that moved money each lead from the stored payload or bank line to the journal entries that recorded them. Failed and pending ones have no entries.',
    pass: broken === 0, value: broken ? broken + ' broken' : S.txnList.length + ' / ' + S.txnList.length,
  });

  const settled = Array.from(S.batches.values()).filter(b => b.settled);
  const badB = settled.filter(b => {
    const line = b.lineId ? S.bankById.get(b.lineId) : undefined;
    const gross = b.txns.reduce((s, id) => s + (S.txns.get(id)?.amount ?? 0), 0);
    const e = b.entry ? byId.get(b.entry) : undefined;
    return !line || line.amount !== b.received || gross !== b.gross || !e || !e.src.includes(line.id);
  }).length;
  out.push({
    title: 'Every settlement ties to one bank line and its payments',
    detail: settled.length + ' settled batches: the payments in each add up to its gross, and the bank line it matched carries exactly the amount received.',
    pass: badB === 0, value: badB ? badB + ' do not tie' : settled.length + ' / ' + settled.length,
  });

  const ignoredBank = new Set(S.ignored.filter(x => !isRaw(x)).map(x => x.id));
  const lines = S.bank.filter(l => !ignoredBank.has(l.id));
  const toBatch = new Set<string>(), toClaim = new Set<string>(), held = new Set<string>();
  for (const b of S.batches.values()) if (b.lineId) toBatch.add(b.lineId);
  for (const e of S.exceptions) for (const r of e.recoveredBy || []) toClaim.add(r);
  for (const t of S.txnList) if (t.ch === 'BR') held.add(t.tid);
  const lost = lines.filter(l => !toBatch.has(l.id) && !toClaim.has(l.id) && !held.has(l.id)).length;
  const count = (f: (id: string) => boolean) => lines.filter(l => f(l.id)).length;
  out.push({
    title: 'Every bank credit is accounted for',
    detail: lines.length + ' bank lines: ' + count(id => toBatch.has(id)) + ' settled a channel batch, ' + count(id => toClaim.has(id) && !held.has(id)) + ' paid back a claim, '
      + count(id => held.has(id)) + ' arrived with no payment record and went to review. ' + ignoredBank.size + ' repeats ignored.',
    pass: lost === 0, value: lost ? lost + ' unaccounted' : lines.length + ' / ' + lines.length,
  });

  const decidedBy = new Map<string, string>();
  for (const ex of S.exceptions) if (ex.resolution?.je) decidedBy.set(ex.resolution.je, ex.resolution.by);
  const ops = E.filter(e => e.actor.startsWith('ops'));
  const anon = ops.filter(e => decidedBy.get(e.id) !== e.actor).length;
  const reasons = S.exceptions.filter(e => e.resolution?.reason || e.claim?.reason).length;
  out.push({
    title: 'Every staff decision is attributed',
    detail: ops.length + ' entries posted by staff, each tied to the review item it settled and the person who decided it. ' + reasons + ' decision' + (reasons === 1 ? ' carries' : 's carry') + ' the staff member’s own reason.',
    pass: anon === 0, value: anon ? anon + ' unattributed' : ops.length + ' / ' + ops.length,
  });

  const mine = E.filter(e => e.lines.some(l => l.sub && S.bById.has(l.sub)));
  const unexplained = mine.filter(e => {
    const en = explain(e, 'en'), ur = explain(e, 'ur');
    return !en || !ur || /undefined|NaN|\{/.test(en + ur) || !/[؀-ۿ]/.test(ur);
  }).length;
  out.push({
    title: 'Every change a borrower sees is explained in English and Urdu',
    detail: mine.length + ' entries touch a borrower’s loan, credit or refund; each has a sentence in both languages built from its own numbers.',
    pass: unexplained === 0, value: unexplained ? unexplained + ' missing' : mine.length + ' / ' + mine.length,
  });
  return out;
}

/* ---------------- Exceptional payment states ---------------- */
export interface StateRow { key: string; label: string; handling: string; count: number; bad: number; example: string | null; tid: string | null }

/** Each exceptional payment state, how many this book has seen, and whether every one was handled as designed. */
export function stateCoverage(S: State): StateRow[] {
  const E = S.ledger.entries, byId = new Map(E.map(e => [e.id, e]));
  const rows: StateRow[] = [];
  type Item = { id: string; ok: boolean; tid?: string | null };
  const row = (key: string, label: string, handling: string, items: Item[]) => {
    const ex = items.find(i => !i.ok) ?? items[0];
    rows.push({ key, label, handling, count: items.length, bad: items.filter(i => !i.ok).length, example: ex?.id ?? null, tid: ex?.tid ?? null });
  };
  const side = (e: Entry, acct: string, sd: 'dr' | 'cr', bid?: string | null) =>
    e.lines.filter(l => l.acct === acct && (bid === undefined || l.sub === (bid ?? null))).reduce((s, l) => s + l[sd], 0);
  const first = (t: Txn) => (t.entries.length ? byId.get(t.entries[0]) : undefined);
  const txns = (st: TxnState) => S.txnList.filter(t => t.state === st);
  const exs = (k: ExKind) => S.exceptions.filter(e => e.kind === k);
  const heldFirst = (e: Exception): Item => {
    const t = e.tid ? S.txns.get(e.tid) : undefined;
    const f = t && first(t);
    return { id: e.id, tid: e.tid, ok: !!t && !!f && f.reason === 'SUSPENSE_RECEIPT' && side(f, '2100', 'cr') === t.amount };
  };
  const settleEntry = (e: Exception) => { const b = e.batch ? S.batches.get(e.batch) : undefined; return b?.entry ? byId.get(b.entry) : undefined; };
  const perTid = new Map<string, number>();
  for (const t of S.txnList) perTid.set(t.tid, (perTid.get(t.tid) || 0) + 1);

  row('repeat', 'Same payment delivered again', 'Stored as received; the dedupe gate ignores it, so nothing is applied twice.',
    S.ignored.filter(isRaw).map(r => ({ id: r.id, tid: r.tid, ok: (perTid.get(r.tid) ?? 0) <= 1 })));
  row('malformed', 'Malformed payload', 'Stored as received and quarantined with the reason; never posted.',
    S.quarantined.map(q => ({ id: q.re.id, ok: !S.txnList.some(t => t.rawId === q.re.id) })));
  row('failed', 'Failed at the channel', 'Tracked so the borrower sees why; no money moved and nothing is posted.',
    txns('failed').map(t => ({ id: t.tid, tid: t.tid, ok: t.entries.length === 0 })));
  row('pending', 'Still pending at the bank', 'A memo only, never counted as paid; posted once it completes.',
    txns('pending').map(t => ({ id: t.tid, tid: t.tid, ok: t.entries.length === 0 })));
  row('partial', 'Partial payment', 'Applied to the installment; the rest stays due.',
    E.filter(e => e.reason === 'PARTIAL_PAYMENT').map(e => {
      const ap = e.params.applied || [], last = ap[ap.length - 1];
      return { id: e.id, tid: e.params.tid, ok: !!last && last.left > 0 && side(e, '1200', 'cr', e.params.bid) === ap.reduce((s, a) => s + a.amt, 0) };
    }));
  row('overpaid', 'Overpayment', 'Due installments are completed; the extra is saved as the borrower’s credit and used on the next due date.',
    E.filter(e => e.reason === 'OVERPAYMENT_CREDIT').map(e => ({ id: e.id, tid: e.params.tid, ok: (e.params.excess ?? 0) > 0 && side(e, '2000', 'cr', e.params.bid) === e.params.excess })));
  row('duplicate', 'Paid twice within minutes', 'The second payment goes to suspense, not the loan, until staff refund it or keep it.', exs('possible_duplicate').map(heldFirst));
  row('orphan', 'Paid from an unknown phone', 'Held in suspense, never guessed; the borrower’s own report links to it.', exs('orphan_payment').map(heldFirst));
  row('wrongref', 'Reference names someone else’s loan', 'Held, so a missed payment on either loan is not hidden.', exs('reference_conflict').map(heldFirst));
  row('deposit', 'Bank deposit with no payment record', 'Held in suspense until staff find whose money it is.', exs('unexpected_deposit').map(heldFirst));
  row('reversed', 'Reversed by the channel', 'Every entry it caused is mirrored, the installment reopens, and the borrower is told.',
    txns('reversed').map(t => {
      const own = t.entries.map(id => byId.get(id)).filter((e): e is Entry => !!e);
      const net = own.reduce((s, e) => s + side(e, '1200', 'dr') - side(e, '1200', 'cr'), 0);
      const stillApplied = S.insts.some(i => i.parts.some(p => p.tid === t.tid));
      return { id: t.tid, tid: t.tid, ok: own.filter(e => e.reason !== 'CHANNEL_REVERSAL').every(e => !!e.reversedBy) && net === 0 && !stillApplied };
    }));
  row('short', 'Settlement less than expected', 'The gap is booked as a claim on the channel and stays open until it is paid back or accepted as a fee.',
    exs('settlement_short').map(e => { const se = settleEntry(e); return { id: e.id, ok: !!se && side(se, '1300', 'dr') === e.amount }; }));
  row('claimpaid', 'Channel paid back a claim', 'Matched to the open claim, which shrinks or closes.',
    E.filter(e => e.reason === 'CLAIM_RECOVERED').map(e => ({ id: e.id, ok: side(e, '1300', 'cr') === e.params.amount && S.exById.get(e.params.claim ?? '')?.kind === 'settlement_short' })));
  row('overset', 'Settlement more than expected', 'The extra is held in suspense until it is returned to the channel or offset against a claim.',
    exs('settlement_over').map(e => { const se = settleEntry(e); return { id: e.id, ok: !!se && side(se, '2100', 'cr') === e.amount }; }));
  row('missing', 'Settlement never arrived', 'Flagged after two days; the payments still count for the borrowers and show as overdue in transit.',
    exs('missing_deposit').map(e => {
      const b = e.batch ? S.batches.get(e.batch) : undefined;
      return { id: e.id, ok: !!b && (b.settled || (b.late && b.txns.every(id => S.txns.get(id)?.batchLate))) };
    }));
  row('latebatch', 'Paid after its day’s batch settled', 'Rolled into a follow-up batch (…-2) that settles on its own.',
    S.txnList.filter(t => /-SETL-\d{4}-\d{2}-\d{2}-\d+$/.test(t.batchId ?? '')).map(t => ({
      id: t.tid, tid: t.tid, ok: !!S.batches.get(t.batchId!.replace(/-\d+$/, ''))?.settled && !!S.batches.get(t.batchId!)?.txns.includes(t.tid),
    })));
  row('refund', 'Marked for refund', 'Moved from suspense to refunds payable, then paid out with a recorded reference.',
    S.txnList.filter(t => t.state === 'refund_due' || t.state === 'refunded').map(t => {
      const rs = t.entries.map(id => byId.get(id)?.reason);
      return { id: t.tid, tid: t.tid, ok: rs.includes('REFUND_DUE') && (t.state === 'refund_due' || rs.includes('REFUND_PAID')) };
    }));
  row('report', 'Borrower reported a missing payment', 'Linked to the payment it names, or traced with the channel; the borrower sees the outcome.',
    S.reports.map(r => ({ id: r.id, tid: r.tid, ok: !!r.finding })));
  return rows;
}
