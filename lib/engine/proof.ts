// P1 · Ledger proof: invariant checks recomputed from scratch, and a scorecard comparing
// the generator's planted anomalies with what the matcher did on its own.
import { CLEARING, TRUTH_LABEL } from './data';
import { explain } from './explain';
import type { ExKind, Score, ScoreRow, State, Truth, TruthKind } from './types';
import { fmtRs } from './util';

const EXMAP: Partial<Record<TruthKind, ExKind>> = {
  orphan: 'orphan_payment', wrong_reference: 'reference_conflict', possible_duplicate: 'possible_duplicate', reversal: 'reversal',
  unexpected_deposit: 'unexpected_deposit', missing_deposit: 'missing_deposit', short_settlement: 'settlement_short',
};

function detect(S: State, tr: Truth): boolean {
  const ent = (tid: string) => S.ledger.entries.filter(e => e.src[0] === tid);
  const exKind = EXMAP[tr.kind];
  if (exKind) return S.exceptions.some(e => e.kind === exKind && e.key === tr.key);
  const t = S.txns.get(tr.key);
  switch (tr.kind) {
    case 'duplicate_delivery': return S.ignored.some(r => 'tid' in r && r.tid === tr.key) && S.txnList.filter(x => x.tid === tr.key).length === 1;
    case 'failed': return !!t && t.state === 'failed' && ent(tr.key).length === 0;
    case 'pending': return !!t && t.state === 'pending' && ent(tr.key).length === 0;
    case 'partial': return ent(tr.key).some(e => e.reason === 'PARTIAL_PAYMENT');
    case 'overpayment': return ent(tr.key).some(e => e.lines.some(l => l.acct === '2000' && l.cr > 0));
    default: return false;
  }
}

export function scorecard(S: State): Score {
  const rows = new Map<TruthKind, ScoreRow>();
  for (const tr of S.truth) {
    let r = rows.get(tr.kind);
    if (!r) { r = { kind: tr.kind, label: TRUTH_LABEL[tr.kind][0], how: TRUTH_LABEL[tr.kind][1], injected: 0, caught: 0 }; rows.set(tr.kind, r); }
    r.injected++;
    if (detect(S, tr)) r.caught++;
  }
  const keys = new Set(S.truth.filter(t => EXMAP[t.kind]).map(t => EXMAP[t.kind] + '|' + t.key));
  const raised = S.exceptions.filter(e => e.kind !== 'borrower_report');
  const tp = raised.filter(e => keys.has(e.kind + '|' + e.key)).length;
  const auto = S.txnList.filter(t => t.autoRule);
  const correct = auto.filter(t => t.autoBid === t.truthBid).length;
  const list = Array.from(rows.values());
  return {
    rows: list, injected: list.reduce((s, r) => s + r.injected, 0), caught: list.reduce((s, r) => s + r.caught, 0),
    raised: raised.length, tp, fp: raised.length - tp, auto: auto.length, correct,
  };
}

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
    if (!t.state || !['applied', 'held', 'failed', 'pending', 'reversed', 'refund_due'].includes(t.state)) untracked++;
  }
  const inputs = S.raw.length + S.bank.length;
  const accounted = inputs === S.accepted + S.ignored.length;
  const q = S.quarantined.length;
  out.push({
    title: 'No payment is silently dropped',
    detail: S.txnList.length + ' payments: ' + (st.applied || 0) + ' applied, ' + (st.held || 0) + ' held for review, ' + (st.failed || 0) + ' failed, ' + (st.pending || 0) + ' pending, ' + (st.reversed || 0) + ' reversed, ' + (st.refund_due || 0) + ' refund due. ' + S.ignored.length + ' repeat deliveries logged and ignored' + (q ? ', ' + q + ' malformed payloads quarantined' : '') + '.',
    pass: untracked === 0 && accounted, value: untracked ? untracked + ' untracked' : inputs + ' inputs accounted',
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
