import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { borrowerSummary, buildLive, explain, iso, mulberry32, replayFiles, runChecks } from '@/lib/engine';
import type { Action, LiveInputs, PayCh, PayStatus, State } from '@/lib/engine';
import { paymentPayload, rawEventFor, reversalPayload, type PaymentSpec } from '@/lib/ingest/payloads';

const failing = (S: State) => runChecks(S).filter(c => !c.pass).map(c => c.title + ': ' + c.value);
const fingerprint = (S: State) => S.ledger.entries.map(e => JSON.stringify([e.id, e.day, e.reason, e.params, e.lines, e.src, e.actor, e.reverses, explain(e, 'en')]));

/** Builds live-book inputs the way the database stores them: each one stamped with an arrival number. */
class Live {
  ord = 0;
  recv = { day: 70, min: 9 * 60 };
  inp: LiveInputs = { today: 70, borrowers: [], loans: [], raw: [], bank: [], actions: [] };
  at(day: number, min = 600) { this.recv = { day, min }; this.inp.today = Math.max(this.inp.today, day); return this; }
  borrower(id: string, name: string, phone: string, ch: PayCh = 'EP') {
    this.inp.borrowers.push({ ord: ++this.ord, recvDay: this.recv.day, id, name, ur: name, work: 'Tailor', workUr: 'درزی', city: 'Sukkur', phone, ch });
  }
  loan(id: string, bid: string, principalRs: number, feeRs: number, n: number, firstDue: number) {
    this.inp.loans.push({ ord: ++this.ord, recvDay: this.recv.day, id, bid, principal: principalRs * 100, fee: feeRs * 100, n, firstDue });
  }
  pay(spec: Partial<PaymentSpec> & { ch: PayCh; tid: string; amount: number }) {
    this.raw(spec.ch, paymentPayload({ phone: null, name: '', ref: '', status: 'success', day: this.recv.day, min: Math.max(0, this.recv.min - 5), ...spec }));
  }
  raw(ch: PayCh, payload: Record<string, unknown>) {
    const ord = ++this.ord;
    this.inp.raw.push({ ...rawEventFor(ch, payload, this.recv), id: 'RE-' + ord, ord });
  }
  bankLine(amount: number, ref: string, narration = 'CREDIT') {
    const ord = ++this.ord;
    this.inp.bank.push({ id: 'BK-' + ord, ord, day: this.recv.day, min: this.recv.min, amount, ref, narration, key: 'k' + ord, recvDay: this.recv.day, recvMin: this.recv.min });
  }
  act(a: Action, by = 'ops: Test') { this.inp.actions.push({ ...a, ord: ++this.ord, at: this.recv.day, by }); }
  build(today = this.inp.today) { return buildLive({ ...this.inp, today }); }
  /** The inputs as they stood right after arrival number k. */
  upTo(k: number): LiveInputs {
    const f = <T extends { ord?: number }>(xs: T[]) => xs.filter(x => (x.ord ?? 0) <= k);
    return { today: 0, borrowers: f(this.inp.borrowers), loans: f(this.inp.loans), raw: f(this.inp.raw), bank: f(this.inp.bank), actions: f(this.inp.actions) };
  }
  dayOf(k: number): number {
    const all = [...this.inp.borrowers.map(x => [x.ord, x.recvDay]), ...this.inp.loans.map(x => [x.ord, x.recvDay]), ...this.inp.raw.map(x => [x.ord, x.recvDay]),
      ...this.inp.bank.map(x => [x.ord, x.recvDay]), ...this.inp.actions.map(x => [x.ord, x.at])] as [number, number][];
    return all.find(([o]) => o === k)![1];
  }
}

/** Every earlier view's journal must be a prefix of every later one: what was stored never changes. */
function expectPrefixes(L: Live, ks: number[], finalToday: number) {
  const full = fingerprint(L.build(finalToday));
  for (const k of ks) {
    const today = L.dayOf(k);
    const early = fingerprint(buildLive({ ...L.upTo(k), today }));
    expect(full.slice(0, early.length)).toEqual(early);
  }
}

function story() {
  const L = new Live();
  L.at(70, 540);
  L.borrower('B001', 'Ali Raza', '03001234567', 'EP');
  L.borrower('B002', 'Sara Khan', '03111234567', 'JC');
  L.borrower('B003', 'Muhammad Ali', '03211234567', 'CA');
  L.borrower('B004', 'Muhammad Ali', '03331234567', 'RA');
  L.loan('L001', 'B001', 20000, 4000, 12, 72);
  L.loan('L002', 'B002', 12000, 2400, 12, 72);
  L.loan('L003', 'B003', 10000, 2000, 12, 73);
  L.loan('L004', 'B004', 10000, 2000, 12, 73);

  L.at(72, 600);
  L.pay({ ch: 'EP', tid: 'EP10000001', amount: 200000, phone: '+92 300 1234567', name: 'ALI RAZA' });
  L.pay({ ch: 'JC', tid: 'JC20000001', amount: 120000, phone: '03459999999', name: 'SARA KHAN', ref: 'L002' });
  L.pay({ ch: 'CA', tid: 'CA300001', amount: 100000, name: 'MUHAMMAD ALI' });
  L.pay({ ch: 'EP', tid: 'EP10000001', amount: 200000, phone: '+92 300 1234567', name: 'ALI RAZA' }); // repeat delivery
  L.pay({ ch: 'JC', tid: 'JC20000002', amount: 120000, phone: '03111234567', status: 'failed', failReason: 'Wrong PIN entered' });
  L.pay({ ch: 'RA', tid: 'RA40000001', amount: 100000, name: 'MUHAMMAD ALI', ref: 'L004 qist', status: 'pending' });
  L.at(72, 700);
  L.pay({ ch: 'RA', tid: 'RA40000001', amount: 100000, name: 'MUHAMMAD ALI', ref: 'L004 qist' });
  L.bankLine(100000, 'RAAST-RA40000001', 'RAAST CR RA40000001');

  L.at(73, 560);
  L.bankLine(197600 - 15000, 'EP-SETL-' + iso(72), 'EASYPAISA SETTLEMENT');
  L.bankLine(118200, 'JC-SETL-' + iso(72), 'JAZZCASH SETTLEMENT');
  L.at(73, 600);
  L.raw('EP', paymentPayload({ ch: 'EP', tid: 'EP10000002', amount: 50000, phone: '03001234567', name: 'ALI RAZA', ref: '', status: 'success', day: 72, min: 1300 }));

  L.at(74, 600);
  L.act({ type: 'apply', exId: 'EX-ORP-CA300001', bid: 'B003' });
  L.act({ type: 'accept_fee', exId: 'EX-SHT-EP-SETL-' + iso(72) });
  L.act({ type: 'claim', exId: 'EX-MIS-CA-SETL-' + iso(72) });
  L.bankLine(49400, 'EP-SETL-' + iso(72) + '-2', 'EASYPAISA SETTLEMENT');

  L.at(75, 900);
  L.raw('EP', reversalPayload('EP10000001', 'Disputed by account holder', 75, 890));
  L.at(76, 560);
  L.bankLine(99000, 'CA-SETL-' + iso(72), 'AGENT NETWORK SETTLEMENT');
  L.raw('JC', { type: 'TXN_SUCCESS', ref_no: 'JC-BROKEN' }); // malformed: quarantined, not dropped
  return L;
}

describe('live book', () => {
  it('matches, holds, settles and explains real inputs', () => {
    const L = story();
    const S = L.build(80);
    expect(failing(S)).toEqual([]);

    const t = (tid: string) => S.txnList.filter(x => x.tid === tid);
    expect(t('JC20000001')[0]).toMatchObject({ rule: 'R1', borrowerId: 'B002', state: 'applied' });
    expect(t('JC20000002')[0].state).toBe('failed');
    expect(t('RA40000001')).toHaveLength(1);
    expect(t('RA40000001')[0]).toMatchObject({ state: 'applied', borrowerId: 'B004', settled: true });
    expect(t('EP10000001')[0]).toMatchObject({ rule: 'R2', state: 'reversed' });
    expect(S.ignored.filter(r => 'tid' in r && r.tid === 'EP10000001')).toHaveLength(1);
    expect(S.quarantined).toHaveLength(1);

    // Two borrowers share a name, so the name alone matched nobody: held, then applied by ops.
    const orphan = t('CA300001')[0];
    expect(orphan.autoRule).toBeNull();
    expect(orphan).toMatchObject({ state: 'applied', borrowerId: 'B003', rule: 'Ops review' });
    const applied = S.ledger.entries.find(e => e.reason === 'SUSPENSE_APPLIED')!;
    expect(applied.actor).toBe('ops: Test');
    expect(applied.day).toBe(74);

    // A payment for 12 Nov arriving after 12 Nov's batch settled goes to a follow-up batch.
    const late = t('EP10000002')[0];
    expect(late.batchId).toBe('EP-SETL-' + iso(72) + '-2');
    expect(late.settled).toBe(true);

    const ex = (id: string) => S.exById.get(id)!;
    expect(ex('EX-SHT-EP-SETL-' + iso(72)).status).toBe('resolved');
    expect(ex('EX-MIS-CA-SETL-' + iso(72)).status).toBe('resolved');
    expect(ex('EX-MIS-CA-SETL-' + iso(72)).claim?.by).toBe('ops: Test');
    expect(ex('EX-REV-EP10000001').status).toBe('open');

    // Ali's reversal reopened installment #1; his Rs 500 extra became credit and was used on the next due date.
    const ali = borrowerSummary(S, 'B001');
    expect(ali.insts[0].status).toBe('overdue');
    expect(S.ledger.entries.some(e => e.reason === 'CREDIT_APPLIED' && e.params.bid === 'B001' && e.params.no === 2)).toBe(true);
    expect(borrowerSummary(S, 'B002').insts[1].status).toBe('overdue');
  });

  it('every stored journal is a prefix of every later replay', () => {
    const L = story();
    expectPrefixes(L, Array.from({ length: L.ord }, (_, i) => i + 1), 80);
  });

  it('is deterministic and replaying every file changes nothing', () => {
    const L = story();
    expect(fingerprint(L.build(80))).toEqual(fingerprint(L.build(80)));
    const S = L.build(80);
    const r = replayFiles(S);
    expect(r.accepted).toBe(0);
    expect(r.newEntries).toBe(0);
  });

  it('a borrower with no loan yet has a clean summary', () => {
    const L = new Live();
    L.at(70);
    L.borrower('B001', 'New Person', '03001112223');
    const S = L.build(70);
    const sum = borrowerSummary(S, 'B001');
    expect(sum.loan).toBeNull();
    expect(sum.owed).toBe(0);
    expect(failing(S)).toEqual([]);
  });
});

/* ---------- Random live books: any sequence of inputs keeps the books consistent ---------- */
const NAMES = ['Ali Raza', 'Sara Khan', 'Muhammad Ali', 'Muhammad Ali', 'Hina Baloch', 'Zubair Shah'];
function randomBook(seed: number): { L: Live; last: number } {
  const r = mulberry32(seed);
  const ri = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const L = new Live();
  let day = 70, tidN = 0, reports = 0;
  L.at(day, 540);
  const nb = ri(2, 5);
  const people: { id: string; phone: string; loan: string; inst: number }[] = [];
  for (let i = 1; i <= nb; i++) {
    const id = 'B' + String(i).padStart(3, '0'), phone = '030' + String(10000000 + i * 7919);
    L.borrower(id, pick(NAMES), phone, pick(['EP', 'JC', 'CA', 'RA'] as PayCh[]));
    const n = ri(4, 12), principal = ri(5, 30) * 1000;
    L.loan('L' + id.slice(1), id, principal, Math.round(principal * 0.2), n, 71 + ri(0, 3));
    people.push({ id, phone, loan: 'L' + id.slice(1), inst: Math.floor((principal * 1.2 * 100) / n / 100) * 100 });
  }
  const steps = ri(15, 45);
  for (let s = 0; s < steps; s++) {
    if (r() < 0.2 && day < 92) day += ri(1, 2);
    L.at(day, ri(480, 1380));
    const x = r();
    if (x < 0.55) {
      const p = pick(people), ch = pick(['EP', 'JC', 'CA', 'RA'] as PayCh[]);
      const mode = pick(['phone', 'ref', 'name', 'unknown', 'wrongref']);
      const tid = ch + String(10000000 + ++tidN);
      const status: PayStatus = r() < 0.85 ? 'success' : r() < 0.6 ? 'failed' : 'pending';
      const other = pick(people);
      const spec = {
        ch, tid, status, amount: Math.max(100, Math.round((p.inst * pick([1, 1, 0.5, 1.2, 2])) / 100) * 100),
        phone: mode === 'phone' || mode === 'wrongref' ? p.phone : mode === 'unknown' ? '0345' + ri(1000000, 9999999) : null,
        name: mode === 'unknown' ? 'GHULAM MUSTAFA' : 'SOMEONE',
        ref: mode === 'ref' ? p.loan : mode === 'wrongref' ? other.loan : '',
        day: r() < 0.1 ? day - 1 : day, min: ri(0, 470),
      };
      if (mode === 'name') spec.name = NAMES[Number(p.id.slice(1)) % NAMES.length].toUpperCase();
      L.raw(ch, paymentPayload(spec));
      if (r() < 0.1) L.raw(ch, paymentPayload(spec));
      if (ch === 'RA' && status === 'success' && r() < 0.7) L.bankLine(spec.amount, 'RAAST-' + tid, 'RAAST CR ' + tid);
    } else if (x < 0.7) {
      const S = L.build(day);
      const open = [...S.batches.values()].filter(b => !b.settled && b.ch !== 'RA' && b.day < day && b.gross - b.clawback > 0);
      if (!open.length) continue;
      const b = pick(open);
      const fee = Math.round((b.gross * ({ EP: 120, JC: 150, CA: 100 } as Record<string, number>)[b.ch]) / 10000);
      const amt = b.gross - fee - b.clawback + pick([0, 0, 0, -15000, 5000]);
      if (amt > 0) L.bankLine(amt, b.id, 'SETTLEMENT');
    } else if (x < 0.75) {
      const S = L.build(day);
      const done = S.txnList.filter(t => t.ch !== 'BR' && (t.state === 'applied' || t.state === 'held'));
      if (done.length) { const t = pick(done); L.raw(t.ch as PayCh, reversalPayload(t.tid, 'Disputed by account holder', day, 0)); }
    } else if (x < 0.92) {
      const S = L.build(day);
      const open = S.exceptions.filter(e => e.status !== 'resolved' && e.kind !== 'borrower_report');
      if (!open.length) continue;
      const e = pick(open);
      if (['orphan_payment', 'reference_conflict', 'unexpected_deposit', 'possible_duplicate'].includes(e.kind)) {
        L.act(r() < 0.75 ? { type: 'apply', exId: e.id, bid: pick(people).id } : { type: 'refund', exId: e.id });
      } else if (e.kind === 'settlement_short') L.act(r() < 0.5 ? { type: 'accept_fee', exId: e.id } : { type: 'claim', exId: e.id });
      else if (e.kind === 'missing_deposit' || e.kind === 'settlement_over') L.act({ type: 'claim', exId: e.id });
      else L.act({ type: 'ack', exId: e.id });
    } else if (x < 0.96) {
      const S = L.build(day);
      const t = S.txnList.length ? pick(S.txnList) : null;
      L.act({ type: 'report', n: ++reports, bid: pick(people).id, ch: 'JC', amount: 100000, day, tid: t ? t.tid : 'JC99999999' });
    } else if (x < 0.98) {
      L.bankLine(ri(10, 90) * 10000, '', 'CASH DEPOSIT BR-' + ri(1000, 9999));
    } else {
      L.raw('EP', { event: 'payment.completed', txn_id: 'EP-BAD-' + s, amount_pkr: 'lots' });
    }
  }
  return { L, last: day };
}

describe('random live books (property test)', () => {
  it('keep every invariant and never rewrite stored history', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2_000_000_000 }), seed => {
        const { L, last } = randomBook(seed);
        const S = L.build(last + 3);
        expect(failing(S)).toEqual([]);
        const r = mulberry32(seed ^ 0x5bd1e995);
        const ks = Array.from({ length: 4 }, () => 1 + Math.floor(r() * L.ord));
        expectPrefixes(L, ks, last + 3);
      }),
      { numRuns: 40 },
    );
  });
});
