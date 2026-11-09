// P3 · Matching: ingest raw channel events and bank lines, identify borrowers, settle batches,
// raise typed exceptions, and apply recorded ops decisions and borrower reports.
// build() and buildLive() are deterministic: the same inputs and actions always produce the same ledger.
import { normalize } from './adapters';
import { CH, CLR, KCODE, OPS, SYS } from './data';
import { generate } from './generate';
import { makeLedger } from './ledger';
import { scorecard } from './proof';
import type {
  Action, AcctCode, BankLine, Batch, BookKind, Borrower, BorrowerIn, Ch, Entry, EntryParams, ExKind, Exception, Installment, LiveInputs, Loan, LoanIn,
  PayCh, RawEvent, State, Suggest, Truth, TruthTag, Txn,
} from './types';
import { DEMO_TODAY, iso, normPhone } from './util';

export interface Inputs { raw: RawEvent[]; bank: BankLine[] }

interface Init {
  kind: BookKind; seed: number; today: number; borrowers: Borrower[]; loans: Loan[]; insts: Installment[];
  raw: RawEvent[]; bank: BankLine[]; truth: Truth[]; truthByTid: Map<string, TruthTag>;
}
function newState(o: Init): State {
  const S: State = {
    ...o,
    ledger: makeLedger(), txns: new Map(), txnList: [], batches: new Map(), exceptions: [], exById: new Map(), notes: [],
    seenRaw: new Set(), seenBank: new Set(), ignored: [], quarantined: [], accepted: 0, rawById: new Map(), bankById: new Map(),
    reports: [], cur: 0,
    bById: new Map(), loanById: new Map(), loanByBid: new Map(), phoneIdx: new Map(), nameIdx: new Map(), nameDup: new Set(),
    score: { rows: [], injected: 0, caught: 0, raised: 0, tp: 0, fp: 0, auto: 0, correct: 0 }, autoEntryCount: 0,
  };
  for (const b of o.borrowers) indexBorrower(S, b);
  for (const l of o.loans) { S.loanById.set(l.id, l); S.loanByBid.set(l.bid, l); }
  return S;
}
/** Phone and name lookups. A name shared by two borrowers is never used for automatic matching. */
function indexBorrower(S: State, b: Borrower) {
  S.bById.set(b.id, b);
  S.phoneIdx.set(normPhone(b.phone), b.id);
  const nn = normName(b.name);
  if (!nn || S.nameDup.has(nn)) return;
  if (S.nameIdx.has(nn)) { S.nameIdx.delete(nn); S.nameDup.add(nn); return; }
  S.nameIdx.set(nn, b.id);
}

/** Demo book: the seeded scenario, frozen at 9 Nov 2026, with recorded decisions on top. */
export function build(seed: number, actions: Action[] = [], inputs?: Inputs): State {
  const G = generate(seed);
  const S = newState({
    kind: 'demo', seed, today: DEMO_TODAY, borrowers: G.borrowers, loans: G.loans, insts: G.insts,
    raw: inputs ? inputs.raw : G.raw, bank: inputs ? inputs.bank : G.bank, truth: G.truth, truthByTid: G.truthByTid,
  });
  const TODAY = S.today;
  type Ev = { day: number; min: number } & ({ k: 'disb'; L: Loan } | { k: 'due'; i: Installment } | { k: 'raw'; re: RawEvent } | { k: 'bank'; bl: BankLine });
  const tl: Ev[] = [];
  for (const L of S.loans) tl.push({ day: L.start, min: 0, k: 'disb', L });
  for (const i of S.insts) if (i.due <= TODAY) tl.push({ day: i.due, min: 1, k: 'due', i });
  for (const re of S.raw) tl.push({ day: re.day, min: re.min, k: 'raw', re });
  for (const bl of S.bank) tl.push({ day: bl.day, min: bl.min, k: 'bank', bl });
  tl.sort((a, b) => a.day - b.day || a.min - b.min);
  for (const ev of tl) {
    S.cur = ev.day;
    if (ev.k === 'disb') onDisburse(S, ev.L);
    else if (ev.k === 'due') onDue(S, ev.i);
    else if (ev.k === 'raw') onRaw(S, ev.re);
    else onBank(S, ev.bl);
  }
  S.cur = TODAY;
  detectMissing(S);
  S.score = scorecard(S);
  S.autoEntryCount = S.ledger.entries.length;
  for (const a of actions) applyAction(S, a);
  return S;
}

/** Weekly schedule for a live loan. Whole-rupee installments; the last one takes the remainder. */
export function scheduleFor(l: Pick<LoanIn, 'id' | 'bid' | 'principal' | 'fee' | 'n' | 'firstDue'>): { loan: Omit<Loan, 'start'>; insts: Installment[] } {
  const total = l.principal + l.fee;
  const instAmt = Math.floor(total / l.n / 100) * 100;
  const insts: Installment[] = [];
  for (let k = 1; k <= l.n; k++) {
    const amount = k < l.n ? instAmt : total - instAmt * (l.n - 1);
    insts.push({ id: l.id + '-' + String(k).padStart(2, '0'), loanId: l.id, bid: l.bid, no: k, due: l.firstDue + 7 * (k - 1), amount, paid: 0, parts: [], fullDay: null });
  }
  return { loan: { id: l.id, bid: l.bid, principal: l.principal, fee: l.fee, total, n: l.n, instAmt }, insts };
}

/**
 * Live book: borrowers, loans, channel events, bank lines and decisions as they actually arrived.
 * Everything is replayed in arrival order (ord), and installment due dates are processed at the start
 * of their day, so a stored journal is always a prefix of any later replay.
 */
export function buildLive(inp: LiveInputs): State {
  const S = newState({ kind: 'live', seed: 0, today: inp.today, borrowers: [], loans: [], insts: [], raw: inp.raw, bank: inp.bank, truth: [], truthByTid: new Map() });
  type It = { ord: number; day: number } & ({ k: 'b'; b: BorrowerIn } | { k: 'l'; l: LoanIn } | { k: 'raw'; re: RawEvent } | { k: 'bank'; bl: BankLine } | { k: 'act'; a: Action });
  const items: It[] = [];
  for (const b of inp.borrowers) items.push({ ord: b.ord, day: b.recvDay, k: 'b', b });
  for (const l of inp.loans) items.push({ ord: l.ord, day: l.recvDay, k: 'l', l });
  for (const re of inp.raw) items.push({ ord: re.ord ?? 0, day: re.recvDay ?? re.day, k: 'raw', re });
  for (const bl of inp.bank) items.push({ ord: bl.ord ?? 0, day: bl.recvDay ?? bl.day, k: 'bank', bl });
  for (const a of inp.actions) items.push({ ord: a.ord ?? 0, day: a.at ?? inp.today, k: 'act', a });
  items.sort((x, y) => x.ord - y.ord);

  const queue: Installment[] = [];
  let dirty = false;
  const flush = (upTo: number) => {
    if (dirty) { queue.sort((a, b) => a.due - b.due); dirty = false; }
    while (queue.length && queue[0].due <= upTo) {
      const i = queue.shift()!;
      S.cur = i.due;
      onDue(S, i);
    }
  };
  let lastDay = -Infinity;
  for (const it of items) {
    flush(it.day);
    if (it.day > lastDay) { detectMissing(S, it.day); lastDay = it.day; }
    S.cur = it.day;
    if (it.k === 'b') {
      const { ord: _o, recvDay: _r, ...b } = it.b;
      void _o; void _r;
      const bor: Borrower = { ...b, loanId: null };
      S.borrowers.push(bor);
      indexBorrower(S, bor);
    } else if (it.k === 'l') {
      const bor = S.bById.get(it.l.bid);
      if (!bor || S.loanByBid.has(bor.id)) { S.notes.push({ day: it.day, by: 'system', text: 'Loan ' + it.l.id + ' ignored: borrower missing or already has a loan' }); continue; }
      const { loan, insts } = scheduleFor(it.l);
      const L: Loan = { ...loan, start: it.day };
      S.loans.push(L);
      S.loanById.set(L.id, L);
      S.loanByBid.set(L.bid, L);
      bor.loanId = L.id;
      S.insts.push(...insts);
      queue.push(...insts);
      dirty = true;
      onDisburse(S, L);
    } else if (it.k === 'raw') onRaw(S, it.re);
    else if (it.k === 'bank') onBank(S, it.bl);
    else applyAction(S, it.a);
  }
  flush(S.today);
  S.cur = S.today;
  detectMissing(S);
  const auto = S.txnList.filter(t => t.autoRule);
  S.score = { rows: [], injected: 0, caught: 0, raised: S.exceptions.filter(e => e.kind !== 'borrower_report').length, tp: 0, fp: 0, auto: auto.length, correct: 0 };
  S.autoEntryCount = S.ledger.entries.filter(e => !e.actor.startsWith('ops')).length;
  return S;
}

function onDisburse(S: State, L: Loan) {
  S.ledger.post({
    day: L.start, reason: 'LOAN_DISBURSED', params: { bid: L.bid, loan: L.id, principal: L.principal, fee: L.fee, total: L.total, n: L.n },
    lines: [{ acct: '1200', sub: L.bid, dr: L.total }, { acct: '3000', cr: L.principal }, { acct: '4000', cr: L.fee }], src: [L.id], actor: 'system: loan book',
  });
}
function onDue(S: State, i: Installment) {
  const credit = -S.ledger.balance('2000', i.bid);
  const rem = i.amount - i.paid;
  if (credit > 0 && rem > 0) {
    const use = Math.min(credit, rem);
    S.ledger.post({ day: i.due, reason: 'CREDIT_APPLIED', params: { bid: i.bid, amt: use, no: i.no }, lines: [{ acct: '2000', sub: i.bid, dr: use }, { acct: '1200', sub: i.bid, cr: use }], src: [i.id], actor: SYS });
    i.paid += use;
    i.parts.push({ tid: null, amt: use, day: i.due });
    if (i.paid >= i.amount) i.fullDay = i.due;
  }
}
function onRaw(S: State, re: RawEvent) {
  S.rawById.set(re.id, re);
  if (S.seenRaw.has(re.key)) { S.ignored.push(re); return; }
  S.seenRaw.add(re.key);
  S.accepted++;
  let c;
  try { c = normalize(re); } catch (err) {
    const issues = (err as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
    S.quarantined.push({ re, error: issues ? issues.map(i => (i.path.length ? i.path.map(String).join('.') + ': ' : '') + i.message).join('; ') : err instanceof Error ? err.message : String(err) });
    return;
  }
  if (c.type === 'reversal') onReversal(S, c); else onPayment(S, c);
}

export function normName(s: string | null | undefined): string {
  return String(s || '').toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim();
}
function bigrams(s: string): string[] {
  const x = s.replace(/ /g, ''); const out: string[] = [];
  for (let i = 0; i < x.length - 1; i++) out.push(x.slice(i, i + 2));
  return out;
}
function dice(a: string, b: string): number {
  const A = bigrams(a), Bg = bigrams(b);
  if (!A.length || !Bg.length) return 0;
  const m = new Map<string, number>();
  for (const g of A) m.set(g, (m.get(g) || 0) + 1);
  let hit = 0;
  for (const g of Bg) { const c = m.get(g); if (c) { hit++; m.set(g, c - 1); } }
  return (2 * hit) / (A.length + Bg.length);
}

type Ident =
  | { bid: string; rule: 'R1' | 'R2' | 'R3'; conf: number }
  | { conflict: { refBid: string; suggest: string; via: string } }
  | { bid: null; suggest: Suggest | null };

function identify(S: State, t: Txn): Ident {
  const m = /\bL(\d{2,})\b/i.exec(t.ref || '');
  const loan = m ? S.loanById.get('L' + m[1]) : undefined;
  const byRef = loan ? loan.bid : null;
  const byPhone = t.phone ? S.phoneIdx.get(normPhone(t.phone)) || null : null;
  const nn = normName(t.name);
  const byName = nn ? S.nameIdx.get(nn) || null : null;
  if (byRef) {
    const other = byPhone || byName;
    if (other && other !== byRef) return { conflict: { refBid: byRef, suggest: other, via: byPhone ? 'registered phone' : 'account name' } };
    return { bid: byRef, rule: 'R1', conf: 1 };
  }
  if (byPhone) return { bid: byPhone, rule: 'R2', conf: 0.97 };
  if (byName) return { bid: byName, rule: 'R3', conf: 0.9 };
  // No safe match: only suggestions from here, never an automatic decision.
  let best: Suggest | null = null;
  const toks = String(t.ref || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const b of S.borrowers) {
    const first = b.name.split(' ')[0].toLowerCase();
    if (toks.includes(first)) { best = { bid: b.id, why: 'Reference mentions “' + first + '”' }; break; }
  }
  if (!best && nn) {
    let top = 0;
    for (const b of S.borrowers) {
      const sc = dice(nn, normName(b.name));
      if (sc >= 0.75 && sc > top) { top = sc; best = { bid: b.id, why: 'Payer name is ' + Math.round(sc * 100) + '% similar to ' + b.name }; }
    }
  }
  return { bid: null, suggest: best };
}

function newTxn(o: Pick<Txn, 'tid' | 'ch' | 'day' | 'min' | 'amount' | 'phone' | 'name' | 'ref' | 'status' | 'failReason' | 'rawId'> & Partial<Txn>): Txn {
  return {
    borrowerId: null, rule: null, conf: 0, autoRule: null, autoBid: null, state: null, batchId: null, settled: false, settleDay: null,
    batchLate: false, exId: null, suggest: null, reversed: null, entries: [], truthBid: null, heldOnce: false, ...o,
  };
}

function onPayment(S: State, c: Extract<ReturnType<typeof normalize>, { type: 'payment' }>) {
  // A pending transfer that later succeeds or fails is the same payment: the final status replaces it.
  const prev = S.txns.get(c.tid);
  if (prev && prev.state === 'pending' && c.status !== 'pending') S.txnList.splice(S.txnList.indexOf(prev), 1);
  const t = newTxn({ tid: c.tid, ch: c.ch, day: c.day, min: c.min, amount: c.amount, phone: c.phone, name: c.name || null, ref: c.ref || '', status: c.status, failReason: c.failReason, rawId: c.rawId });
  const tr = S.truthByTid.get(t.tid);
  t.truthBid = tr ? tr.bid : null;
  S.txns.set(t.tid, t);
  S.txnList.push(t);
  const id = identify(S, t);
  if ('rule' in id) { t.borrowerId = id.bid; t.rule = id.rule; t.conf = id.conf; t.autoRule = id.rule; t.autoBid = id.bid; }
  if (t.status === 'failed') { t.state = 'failed'; if (!t.borrowerId && 'conflict' in id) t.borrowerId = id.conflict.suggest; return; }
  if (t.status === 'pending') { t.state = 'pending'; return; }
  addToBatch(S, t);
  const debit = CLR[t.ch as PayCh];
  if ('conflict' in id) {
    t.suggest = { bid: id.conflict.suggest, why: 'the ' + id.conflict.via + ' belongs to ' + S.bById.get(id.conflict.suggest)!.name };
    return hold(S, t, debit, 'reference_conflict', { refBid: id.conflict.refBid });
  }
  if (!t.borrowerId) {
    t.suggest = 'suggest' in id ? id.suggest : null;
    return hold(S, t, debit, 'orphan_payment', {});
  }
  const dup = S.txnList.find(o => o !== t && o.borrowerId === t.borrowerId && o.ch === t.ch && o.amount === t.amount && o.day === t.day && Math.abs(o.min - t.min) <= 10 && o.state === 'applied');
  if (dup) {
    t.suggest = { bid: t.borrowerId, why: 'Same borrower, amount and channel as ' + dup.tid + ', ' + Math.abs(t.min - dup.min) + ' minutes apart' };
    return hold(S, t, debit, 'possible_duplicate', { dupOf: dup.tid });
  }
  applyPayment(S, t, t.borrowerId, debit, SYS, null, {});
  t.state = 'applied';
}

function addEx(S: State, ex: Omit<Exception, 'status'> & { status?: Exception['status'] }): Exception {
  const full: Exception = { ...ex, status: ex.status || 'open' };
  S.exceptions.push(full);
  S.exById.set(full.id, full);
  return full;
}
function hold(S: State, t: Txn, debit: AcctCode, kind: ExKind, extra: Partial<Exception>) {
  t.state = 'held';
  t.heldOnce = true;
  const e = S.ledger.post({ day: S.cur, reason: 'SUSPENSE_RECEIPT', params: { tid: t.tid, ch: t.ch, amount: t.amount, kind, payDay: t.day }, lines: [{ acct: debit, dr: t.amount }, { acct: '2100', cr: t.amount }], src: [t.tid, t.rawId], actor: SYS });
  t.entries.push(e.id);
  const ex = addEx(S, { id: 'EX-' + KCODE[kind] + '-' + t.tid, kind, key: t.tid, tid: t.tid, day: S.cur, amount: t.amount, bid: t.borrowerId, suggest: t.suggest, ch: t.ch, ...extra });
  t.exId = ex.id;
}
function waterfall(S: State, bid: string, amount: number, payDay: number, tid: string) {
  const open = S.insts.filter(i => i.bid === bid && i.paid < i.amount && i.due <= payDay + 3).sort((a, b) => a.due - b.due);
  let left = amount;
  const applied: { no: number; amt: number; left: number }[] = [];
  for (const i of open) {
    if (!left) break;
    const use = Math.min(left, i.amount - i.paid);
    i.paid += use;
    i.parts.push({ tid, amt: use, day: payDay });
    if (i.paid >= i.amount) i.fullDay = payDay;
    applied.push({ no: i.no, amt: use, left: i.amount - i.paid });
    left -= use;
  }
  return { applied, excess: left };
}
function applyPayment(S: State, t: Txn, bid: string, debitAcct: AcctCode, actor: string, reasonOverride: string | null, extra: EntryParams): Entry {
  const w = waterfall(S, bid, t.amount, t.day, t.tid);
  const appliedSum = t.amount - w.excess;
  const lines: { acct: AcctCode; sub?: string; dr?: number; cr?: number }[] = [{ acct: debitAcct, dr: t.amount }];
  if (appliedSum) lines.push({ acct: '1200', sub: bid, cr: appliedSum });
  if (w.excess) lines.push({ acct: '2000', sub: bid, cr: w.excess });
  const partial = w.applied.length > 0 && w.applied[w.applied.length - 1].left > 0;
  const reason = reasonOverride || (w.excess > 0 ? 'OVERPAYMENT_CREDIT' : partial ? 'PARTIAL_PAYMENT' : 'PAYMENT_APPLIED');
  const e = S.ledger.post({ day: S.cur, reason, params: { tid: t.tid, ch: t.ch, amount: t.amount, payDay: t.day, bid, applied: w.applied, excess: w.excess, phone: t.phone, ref: t.ref, ...extra }, lines, src: [t.tid, t.rawId], actor });
  t.entries.push(e.id);
  return e;
}
/** The open batch for a channel-day. If that day's batch already settled, late items go to <id>-2, -3, … */
function batchFor(S: State, ch: Ch, day: number, tid: string): Batch {
  const base = ch === 'RA' ? 'RA-' + tid : ch + '-SETL-' + iso(day);
  let id = base, b = S.batches.get(id);
  for (let k = 2; b && b.settled; k++) { id = base + '-' + k; b = S.batches.get(id); }
  if (!b) {
    b = { id, ch, day, txns: [], gross: 0, clawback: 0, claws: [], settled: false, settleDay: null, received: null, fee: null, expectedNet: null, diff: null, lineId: null, exId: null, late: false, entry: null };
    S.batches.set(id, b);
  }
  return b;
}
function addToBatch(S: State, t: Txn) {
  const b = batchFor(S, t.ch, t.day, t.tid);
  b.txns.push(t.tid);
  b.gross += t.amount;
  t.batchId = b.id;
}

function onReversal(S: State, c: Extract<ReturnType<typeof normalize>, { type: 'reversal' }>) {
  const t = S.txns.get(c.tid);
  if (!t || t.state === 'reversed' || t.state === 'failed' || t.state === 'pending') {
    S.notes.push({ day: S.cur, by: 'system', text: 'Reversal for ' + c.tid + ' logged; nothing to reverse' });
    return;
  }
  const origs = t.entries.map(id => S.ledger.entries.find(e => e.id === id)).filter((e): e is Entry => !!e && !e.reversedBy);
  const nos: number[] = [];
  for (const e of origs) for (const a of e.params.applied || []) nos.push(a.no);
  for (const e of origs) {
    const lines = e.lines.map(l => ({ acct: l.acct, sub: l.sub, dr: l.cr, cr: l.dr }));
    const r = S.ledger.post({ day: S.cur, reason: 'CHANNEL_REVERSAL', params: { tid: t.tid, ch: t.ch, amount: t.amount, payDay: t.day, reason: c.reason, bid: t.borrowerId, nos }, lines, src: [t.tid, c.rawId, e.id], actor: 'system: channel feed', reverses: e.id });
    e.reversedBy = r.id;
    t.entries.push(r.id);
  }
  for (const i of S.insts) {
    const keep = [];
    for (const p of i.parts) { if (p.tid === t.tid) i.paid -= p.amt; else keep.push(p); }
    i.parts = keep;
    if (i.paid < i.amount) i.fullDay = null;
  }
  t.state = 'reversed';
  t.reversed = { day: c.day, min: c.min, reason: c.reason, rawId: c.rawId };
  const b = batchFor(S, t.ch, c.day, t.tid);
  b.clawback += t.amount;
  b.claws.push(t.tid);
  if (t.exId) {
    const old = S.exById.get(t.exId);
    if (old && old.status !== 'resolved') { old.status = 'resolved'; old.resolution = { action: 'auto', je: null, note: 'Channel reversed the payment', by: 'system', day: S.cur }; }
  }
  const ex = addEx(S, { id: 'EX-REV-' + t.tid, kind: 'reversal', key: t.tid, tid: t.tid, day: S.cur, amount: t.amount, bid: t.borrowerId, reason: c.reason, nos, ch: t.ch });
  t.exId = ex.id;
}

export const bankKey = (bl: BankLine) => bl.key ?? bl.id;
function onBank(S: State, bl: BankLine) {
  S.bankById.set(bl.id, bl);
  if (S.seenBank.has(bankKey(bl))) { S.ignored.push(bl); return; }
  S.seenBank.add(bankKey(bl));
  S.accepted++;
  let b: Batch | undefined;
  if (/^(EP|JC|CA)-SETL-\d{4}-\d{2}-\d{2}(-\d+)?$/.test(bl.ref)) b = S.batches.get(bl.ref);
  else {
    const m = /^RAAST-([A-Za-z0-9]+)(-\d+)?$/.exec(bl.ref || '');
    if (m) b = S.batches.get('RA-' + m[1] + (m[2] || ''));
  }
  // A batch that holds only clawbacks can't be settled by a bank credit; such a credit is held like any unknown deposit.
  if (b && !b.settled && b.gross - b.clawback > 0) return settleBatch(S, b, bl);
  const t = newTxn({ tid: bl.id, ch: 'BR', day: bl.day, min: bl.min, amount: bl.amount, phone: null, name: null, ref: bl.narration, status: 'success', failReason: null, rawId: bl.id, settled: true, settleDay: bl.day });
  const tr = S.truthByTid.get(bl.id);
  t.truthBid = tr ? tr.bid : null;
  S.txns.set(t.tid, t);
  S.txnList.push(t);
  hold(S, t, '1000', 'unexpected_deposit', { lineId: bl.id });
}
function settleBatch(S: State, b: Batch, bl: BankLine) {
  const fee = Math.round((b.gross * CH[b.ch].bps) / 10000);
  const expectedNet = b.gross - fee - b.clawback;
  const diff = expectedNet - bl.amount;
  const lines: { acct: AcctCode; dr?: number; cr?: number }[] = [{ acct: '1000', dr: bl.amount }];
  if (fee) lines.push({ acct: '5000', dr: fee });
  if (diff > 0) lines.push({ acct: '1300', dr: diff });
  lines.push({ acct: CLR[b.ch as PayCh], cr: b.gross - b.clawback });
  if (diff < 0) lines.push({ acct: '2100', cr: -diff });
  const reason = diff > 0 ? 'SETTLEMENT_SHORT' : diff < 0 ? 'SETTLEMENT_OVER' : 'SETTLEMENT';
  const e = S.ledger.post({ day: S.cur, reason, params: { batch: b.id, ch: b.ch, batchDay: b.day, count: b.txns.length, gross: b.gross, fee, bps: CH[b.ch].bps, clawback: b.clawback, net: bl.amount, expectedNet, diff, line: bl.id }, lines, src: [b.id, bl.id], actor: SYS });
  // A settlement that was flagged as missing (live books flag as they go) closes that review item.
  const missing = b.exId ? S.exById.get(b.exId) : undefined;
  if (missing && missing.kind === 'missing_deposit' && missing.status !== 'resolved') {
    missing.status = 'resolved';
    missing.resolution = { action: 'auto', je: e.id, note: 'Settlement arrived late, in bank line ' + bl.id, by: 'system', day: S.cur };
  }
  Object.assign(b, { settled: true, settleDay: bl.day, received: bl.amount, fee, expectedNet, diff, lineId: bl.id, entry: e.id });
  for (const tid of b.txns) { const t = S.txns.get(tid)!; t.settled = true; t.settleDay = bl.day; }
  if (diff > 0) b.exId = addEx(S, { id: 'EX-SHT-' + b.id, kind: 'settlement_short', key: b.id, batch: b.id, day: S.cur, amount: diff, ch: b.ch }).id;
  if (diff < 0) b.exId = addEx(S, { id: 'EX-OVR-' + b.id, kind: 'settlement_over', key: b.id, batch: b.id, day: S.cur, amount: -diff, ch: b.ch }).id;
}
/** Flag channel batches with no deposit two days after the payment day. Safe to call repeatedly. */
function detectMissing(S: State, asOf: number = S.today) {
  for (const b of S.batches.values()) {
    if (b.settled || b.late || b.ch === 'RA' || b.day + 2 > asOf || b.gross - b.clawback <= 0) continue;
    const fee = Math.round((b.gross * CH[b.ch].bps) / 10000);
    b.late = true;
    b.expectedNet = b.gross - fee - b.clawback;
    b.fee = fee;
    b.exId = addEx(S, { id: 'EX-MIS-' + b.id, kind: 'missing_deposit', key: b.id, batch: b.id, day: b.day + 2, amount: b.expectedNet, ch: b.ch }).id;
    for (const tid of b.txns) S.txns.get(tid)!.batchLate = true;
  }
}

/* ---------------- Ops decisions and borrower reports ---------------- */
function applyAction(S: State, a: Action) {
  const TODAY = a.at ?? S.today;
  const OPS_BY = a.by || OPS;
  S.cur = TODAY;
  if (a.type === 'report') { addReport(S, a, TODAY); return; }
  const ex = S.exById.get(a.exId);
  if (!ex || ex.status === 'resolved') return;
  if (a.type === 'apply') {
    const t = ex.tid ? S.txns.get(ex.tid) : undefined;
    if (!t || t.state !== 'held' || !S.bById.has(a.bid)) return;
    t.borrowerId = a.bid; t.rule = 'Ops review'; t.conf = 1;
    const e = applyPayment(S, t, a.bid, '2100', OPS_BY, 'SUSPENSE_APPLIED', { kind: ex.kind });
    t.state = 'applied';
    resolveEx(S, ex, 'apply', e.id, 'Applied to ' + S.bById.get(a.bid)!.name, OPS_BY, TODAY);
  } else if (a.type === 'refund') {
    const t = ex.tid ? S.txns.get(ex.tid) : undefined;
    if (!t || t.state !== 'held') return;
    const bid = t.borrowerId || null;
    const e = S.ledger.post({ day: TODAY, reason: 'REFUND_DUE', params: { tid: t.tid, ch: t.ch, amount: t.amount, payDay: t.day, bid }, lines: [{ acct: '2100', dr: t.amount }, { acct: '2200', sub: bid, cr: t.amount }], src: [t.tid, ex.id], actor: OPS_BY });
    t.entries.push(e.id);
    t.state = 'refund_due';
    resolveEx(S, ex, 'refund', e.id, 'Marked for refund to sender', OPS_BY, TODAY);
  } else if (a.type === 'accept_fee') {
    const b = ex.batch ? S.batches.get(ex.batch) : undefined;
    if (!b || ex.kind !== 'settlement_short') return;
    const e = S.ledger.post({ day: TODAY, reason: 'FEE_ACCEPTED', params: { batch: b.id, ch: b.ch, batchDay: b.day, diff: ex.amount }, lines: [{ acct: '5000', dr: ex.amount }, { acct: '1300', cr: ex.amount }], src: [b.id, ex.id], actor: OPS_BY });
    resolveEx(S, ex, 'accept_fee', e.id, 'Accepted as an extra channel fee', OPS_BY, TODAY);
  } else if (a.type === 'claim') {
    if (ex.status === 'claimed') return;
    ex.status = 'claimed';
    ex.claim = { day: TODAY, by: OPS_BY };
    S.notes.push({ day: TODAY, by: OPS_BY, ex: ex.id, text: 'Claim raised with ' + (ex.ch ? CH[ex.ch].name : 'channel') });
  } else if (a.type === 'ack') {
    resolveEx(S, ex, 'ack', null, ex.kind === 'reversal' ? 'Borrower notified by SMS' : 'Checked by ops', OPS_BY, TODAY);
  }
}
function resolveEx(S: State, ex: Exception, action: string, je: string | null, note: string, by: string, day: number) {
  ex.status = 'resolved';
  ex.resolution = { action, je, note, by, day };
  for (const r of S.exceptions) {
    if (r.kind === 'borrower_report' && r.linked === ex.id && r.status !== 'resolved') {
      r.status = 'resolved';
      r.resolution = { action: 'linked', je, note: 'Resolved with ' + ex.id, by, day };
    }
  }
}
function addReport(S: State, a: Extract<Action, { type: 'report' }>, TODAY: number) {
  const id = 'EX-RPT-' + String(a.n).padStart(3, '0');
  if (S.exById.has(id)) return;
  const tid = String(a.tid || '').trim().toUpperCase();
  const ex: Exception = { id, kind: 'borrower_report', key: id, day: TODAY, bid: a.bid, amount: a.amount, ch: a.ch, payDay: a.day, reportedTid: tid, tid: null, status: 'open' };
  const t = S.txns.get(tid);
  if (!t) ex.finding = 'not_found';
  else {
    ex.tid = t.tid;
    if (t.state === 'held') { ex.finding = 'held'; ex.linked = t.exId; }
    else if (t.state === 'applied' && t.borrowerId === a.bid) { ex.finding = 'already'; ex.status = 'resolved'; ex.resolution = { action: 'auto', je: null, note: 'Already applied to this borrower', by: 'system', day: TODAY }; }
    else if (t.state === 'applied') ex.finding = 'other';
    else if (t.state === 'failed') { ex.finding = 'failed'; ex.status = 'resolved'; ex.resolution = { action: 'auto', je: null, note: 'Failed at the channel; no money moved', by: 'system', day: TODAY }; }
    else if (t.state === 'pending') { ex.finding = 'pending'; ex.status = 'resolved'; ex.resolution = { action: 'auto', je: null, note: 'Still processing at the bank', by: 'system', day: TODAY }; }
    else ex.finding = t.state || 'unknown';
  }
  S.exceptions.push(ex);
  S.exById.set(id, ex);
  S.reports.push(ex);
}

/** Re-send every channel event and bank line through the same dedupe gates the pipeline uses. */
export function replayFiles(S: State) {
  const before = S.ledger.entries.length;
  let accepted = 0, rejected = 0;
  for (const re of S.raw) { if (S.seenRaw.has(re.key)) rejected++; else { accepted++; onRaw(S, re); } }
  for (const bl of S.bank) { if (S.seenBank.has(bankKey(bl))) rejected++; else { accepted++; onBank(S, bl); } }
  return { sent: S.raw.length + S.bank.length, accepted, rejected, newEntries: S.ledger.entries.length - before };
}
