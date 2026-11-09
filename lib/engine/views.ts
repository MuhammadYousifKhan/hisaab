// Read-only views derived from engine state. Projections live here and never touch the ledger.
import { ACCTS, CH, CLEARING } from './data';
import type { AcctCode, Entry, Exception, Installment, Loan, State, Txn } from './types';

export type InstStatus = 'ontime' | 'late' | 'overdue' | 'today' | 'upcoming';
export interface InstView extends Installment { status: InstStatus }

export function instStatus(i: Installment, today: number): InstStatus {
  if (i.paid >= i.amount) return (i.fullDay ?? Infinity) <= i.due ? 'ontime' : 'late';
  if (i.due < today) return 'overdue';
  if (i.due === today) return 'today';
  return 'upcoming';
}

const APPLY = new Set(['PAYMENT_APPLIED', 'PARTIAL_PAYMENT', 'OVERPAYMENT_CREDIT', 'SUSPENSE_APPLIED']);
export function entryById(S: State, id: string): Entry | undefined {
  return S.ledger.entries.find(e => e.id === id);
}
/** Which installments a payment went to, and any extra saved as credit. */
export function appliedInfo(S: State, t: Txn): { nos: number[]; excess: number } | null {
  for (const id of t.entries) {
    const e = entryById(S, id);
    if (e && APPLY.has(e.reason)) return { nos: (e.params.applied || []).map(a => a.no), excess: e.params.excess || 0 };
  }
  return null;
}

export interface BorrowerSummary {
  b: State['borrowers'][number]; loan: Loan | null; insts: InstView[];
  owed: number; credit: number; paid: number; pays: Txn[]; onWay: number;
  overdue: InstView[]; next: InstView | null; changes: Entry[];
  record: { due: number; paid: number; onTime: number; late: number; streak: number; months: number; repaid: number };
  est: { a: number; b: number; rate: number } | null; reports: Exception[];
}

export function borrowerSummary(S: State, bid: string): BorrowerSummary {
  const TODAY = S.today;
  const b = S.bById.get(bid)!, loan = S.loanByBid.get(bid) ?? null;
  const insts: InstView[] = S.insts.filter(i => i.bid === bid).map(i => ({ ...i, status: instStatus(i, TODAY) }));
  const owed = S.ledger.balance('1200', bid);
  const credit = -S.ledger.balance('2000', bid);
  const paid = loan ? loan.total - owed : 0;
  const linked = new Set(S.reports.filter(r => r.bid === bid && r.tid).map(r => r.tid as string));
  const pays = S.txnList.filter(t => t.borrowerId === bid || linked.has(t.tid)).slice().sort((x, y) => y.day - x.day || y.min - x.min);
  const onWay = pays.filter(t => t.state === 'applied' && !t.settled && t.borrowerId === bid).reduce((s, t) => s + t.amount, 0);
  const open = insts.filter(i => i.paid < i.amount);
  const overdue = open.filter(i => i.due < TODAY);
  const next = open.find(i => i.due >= TODAY) || null;
  const changes = S.ledger.entries.filter(e => e.lines.some(l => l.sub === bid)).slice().reverse();
  const dueSoFar = insts.filter(i => i.due <= TODAY);
  const full = insts.filter(i => i.paid >= i.amount);
  const onTime = full.filter(i => (i.fullDay ?? Infinity) <= i.due).length;
  let streak = 0;
  for (const i of dueSoFar.slice().reverse()) {
    if (i.due === TODAY && i.paid < i.amount) continue;
    if (i.paid >= i.amount && (i.fullDay ?? Infinity) <= i.due) streak++;
    else break;
  }
  const record = {
    due: dueSoFar.length, paid: full.length, onTime, late: full.length - onTime, streak,
    months: loan ? Math.max(1, Math.round((TODAY - loan.start) / 30.4)) : 0, repaid: insts.reduce((s, i) => s + i.paid, 0),
  };
  let est: BorrowerSummary['est'] = null;
  if (open.length) {
    const lastDue = insts[insts.length - 1].due;
    const rate = dueSoFar.length ? onTime / dueSoFar.length : 1;
    const a = lastDue + overdue.length * 7;
    est = { a, b: a + (rate >= 0.85 ? 7 : 21), rate };
  }
  const reports = S.reports.filter(r => r.bid === bid).slice().reverse();
  return { b, loan, insts, owed, credit, paid, pays, onWay, overdue, next, changes, record, est, reports };
}

function onTimeRate(S: State, bid: string): number {
  const due = S.insts.filter(i => i.bid === bid && i.due < S.today);
  const ok = due.filter(i => i.paid >= i.amount && (i.fullDay ?? Infinity) <= i.due).length;
  return (ok + 1) / (due.length + 2);
}

export interface ForecastDay { day: number; low: number; mid: number; high: number }
/** Projection only. Never posted, never added to actual figures. */
export function forecastDaily(S: State, horizon = 14): ForecastDay[] {
  const credit = new Map(S.borrowers.map(b => [b.id, Math.max(0, -S.ledger.balance('2000', b.id))]));
  const rate = new Map(S.borrowers.map(b => [b.id, onTimeRate(S, b.id)]));
  const out: ForecastDay[] = [];
  for (let d = S.today + 1; d <= S.today + horizon; d++) {
    let lo = 0, mid = 0, hi = 0;
    for (const i of S.insts) {
      if (i.due !== d) continue;
      let rem = Math.max(0, i.amount - i.paid);
      const c = credit.get(i.bid) || 0;
      const use = Math.min(c, rem);
      rem -= use;
      credit.set(i.bid, c - use);
      const p = rate.get(i.bid) || 0;
      lo += rem * Math.max(0, p - 0.2);
      mid += rem * p;
      hi += rem * Math.min(1, p + 0.1);
    }
    out.push({ day: d, low: Math.round(lo), mid: Math.round(mid), high: Math.round(hi) });
  }
  return out;
}
export function forecastTotal(S: State, horizon = 14) {
  const f = forecastDaily(S, horizon);
  return { low: f.reduce((s, x) => s + x.low, 0), mid: f.reduce((s, x) => s + x.mid, 0), high: f.reduce((s, x) => s + x.high, 0), from: S.today + 1, to: S.today + horizon };
}

export function bankByDay(S: State): Map<number, number> {
  const m = new Map<number, number>();
  for (const e of S.ledger.entries) for (const l of e.lines) if (l.acct === '1000' && l.dr) m.set(e.day, (m.get(e.day) || 0) + l.dr);
  return m;
}

export function kpis(S: State) {
  const L = S.ledger;
  const success = S.txnList.filter(t => t.ch !== 'BR' && t.status === 'success');
  const auto = success.filter(t => t.autoRule && !t.heldOnce);
  let overdueTransit = 0;
  for (const b of S.batches.values()) if (b.late && !b.settled) overdueTransit += b.gross - b.clawback;
  const pend = S.txnList.filter(t => t.state === 'pending');
  return {
    bank: L.balance('1000'), fees: L.balance('5000'),
    transit: CLEARING.reduce((s, a) => s + L.balance(a), 0), overdueTransit,
    pending: pend.reduce((s, t) => s + t.amount, 0), pendingN: pend.length,
    suspense: -L.balance('2100'), claims: L.balance('1300'),
    open: S.exceptions.filter(e => e.status === 'open').length, claimed: S.exceptions.filter(e => e.status === 'claimed').length,
    autoN: auto.length, successN: success.length,
  };
}

export function trialBalance(S: State) {
  return (Object.keys(ACCTS) as AcctCode[]).map(code => ({ code, name: ACCTS[code].name, type: ACCTS[code].type, bal: S.ledger.balance(code) }));
}

export function txState(t: Txn): { cls: string; icon: string; label: string; key: string } {
  if (t.state === 'failed') return { cls: 'crit', icon: '✕', label: 'Failed', key: 'failed' };
  if (t.state === 'pending') return { cls: 'neutral', icon: '…', label: 'Pending', key: 'pending' };
  if (t.state === 'reversed') return { cls: 'crit', icon: '↺', label: 'Reversed', key: 'reversed' };
  if (t.state === 'refund_due') return { cls: 'warn', icon: '↩', label: 'Refund due', key: 'refund_due' };
  if (t.state === 'held') return { cls: 'warn', icon: '?', label: 'Held', key: 'held' };
  if (t.settled) return { cls: 'good', icon: '✓', label: 'Settled', key: 'settled' };
  if (t.batchLate) return { cls: 'crit', icon: '!', label: 'Settlement overdue', key: 'transit' };
  return { cls: 'info', icon: '→', label: 'In transit', key: 'transit' };
}

export const chName = (ch: keyof typeof CH, lang: 'en' | 'ur' = 'en') => (lang === 'ur' ? CH[ch].ur : CH[ch].name);
