// P2 · Data: seeded synthetic scenario. The same seed always gives the same month of payments.
// Scripted stories (Ali, Shazia, Bilal...) carry the challenge's edge cases; the seed adds random noise on top.
import { CH, FAILS, MISSING_BATCH, PEOPLE, SHORT_BATCH, STRANGERS } from './data';
import type { BankLine, Generated, Installment, Loan, PayCh, PayStatus, Person, RawEvent, Truth, TruthKind, TruthTag } from './types';
import { DEMO_TODAY as TODAY, amtStr, iso, mulberry32, stamp } from './util';

interface PaySpec {
  tid: string; ch: PayCh; day: number; min: number; amt: number; phone: string | null; name: string; ref: string;
  status: PayStatus; failReason: string | null; dupDelivery: boolean;
  reversal: { day: number; min: number; reason: string } | null; truthBid: string | null; anomaly: TruthKind | null;
}
interface PayOpts {
  bid: string | null; ch: PayCh; day: number; min: number; amt: number; phone?: string | null; name?: string; ref?: string;
  status?: PayStatus; failReason?: string; dupDelivery?: boolean; reversal?: PaySpec['reversal']; truthBid?: string | null; anomaly?: TruthKind;
}

export function generate(seed: number): Generated {
  const rnd = mulberry32(seed >>> 0 || 1);
  const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const borrowers: (Person & { loanId: string })[] = PEOPLE.map(p => ({ ...p, loanId: 'L' + p.id.slice(1) }));
  const B = (id: string) => borrowers.find(b => b.id === id)!;
  const loans: Loan[] = [];
  const insts: Installment[] = [];
  for (const b of borrowers) {
    const total = b.n * b.inst * 100, principal = b.principal * 100;
    loans.push({ id: b.loanId, bid: b.id, principal, fee: total - principal, total, n: b.n, instAmt: b.inst * 100, start: b.firstDue - 7 });
    for (let k = 1; k <= b.n; k++) {
      insts.push({ id: b.loanId + '-' + String(k).padStart(2, '0'), loanId: b.loanId, bid: b.id, no: k, due: b.firstDue + 7 * (k - 1), amount: b.inst * 100, paid: 0, parts: [], fullDay: null });
    }
  }
  const pays: PaySpec[] = [];
  const truth: Truth[] = [];
  const used = new Set<string>();
  const phones = new Set(borrowers.map(b => b.phone));
  function newTid(ch: PayCh): string {
    let id: string;
    do { id = ch + (ch === 'CA' ? String(ri(100000, 999999)) : String(ri(10000000, 99999999))); } while (used.has(id));
    used.add(id);
    return id;
  }
  function addPay(o: PayOpts): PaySpec {
    const b = o.bid ? B(o.bid) : null;
    const ch = o.ch;
    const p: PaySpec = {
      tid: newTid(ch), ch, day: o.day, min: o.min, amt: o.amt,
      phone: o.phone !== undefined ? o.phone : b && (ch === 'EP' || ch === 'JC') ? b.phone : null,
      name: o.name || (b ? b.name.toUpperCase() : ''),
      ref: o.ref !== undefined ? o.ref : b && (ch === 'CA' || ch === 'RA') ? b.loanId : '',
      status: o.status || 'success', failReason: o.failReason || null, dupDelivery: !!o.dupDelivery, reversal: o.reversal || null,
      truthBid: o.truthBid !== undefined ? o.truthBid : o.bid, anomaly: o.anomaly || null,
    };
    pays.push(p);
    if (p.anomaly) truth.push({ kind: p.anomaly, key: p.tid });
    return p;
  }
  const H = (h: number, m = 0) => h * 60 + m;
  const SCRIPT: Record<string, () => void> = {
    'L01-10': () => {
      addPay({ bid: 'B01', ch: 'EP', day: 62, min: H(19, 40), amt: 300000, anomaly: 'partial' });
      addPay({ bid: 'B01', ch: 'CA', day: 63, min: H(11, 5), amt: 205000, ref: 'L01', anomaly: 'overpayment' });
    },
    'L02-10': () => { addPay({ bid: 'B02', ch: 'JC', day: 66, min: H(20, 12), amt: 300000, phone: '03457717788', name: 'RUBINA BIBI', ref: 'silai shazia', anomaly: 'orphan' }); },
    'L03-10': () => { addPay({ bid: 'B03', ch: 'RA', day: 64, min: H(13, 30), amt: 450000, ref: 'L08 qist', anomaly: 'wrong_reference' }); },
    'L04-10': () => {
      addPay({ bid: 'B04', ch: 'JC', day: 67, min: H(10, 14), amt: 400000 });
      addPay({ bid: 'B04', ch: 'JC', day: 67, min: H(10, 17), amt: 400000, anomaly: 'possible_duplicate' });
    },
    'L05-09': () => { addPay({ bid: 'B05', ch: 'EP', day: 62, min: H(9, 50), amt: 300000, reversal: { day: 65, min: H(15), reason: 'Disputed by account holder' }, anomaly: 'reversal' }); },
    'L06-10': () => {
      addPay({ bid: 'B06', ch: 'JC', day: 65, min: H(18), amt: 250000, status: 'failed', failReason: 'Insufficient wallet balance', anomaly: 'failed' });
      addPay({ bid: 'B06', ch: 'JC', day: 65, min: H(18, 25), amt: 250000 });
    },
    'L07-10': () => { /* paid as a cash deposit at the bank branch: see the bank lines below */ },
    'L08-10': () => { addPay({ bid: 'B08', ch: 'RA', day: 69, min: H(9, 30), amt: 400000, status: 'pending', anomaly: 'pending' }); },
    'L10-10': () => { addPay({ bid: 'B10', ch: 'CA', day: 66, min: H(16), amt: 250000 }); },
    'L11-10': () => { addPay({ bid: 'B11', ch: 'CA', day: 66, min: H(12), amt: 400000 }); },
    'L12-10': () => { addPay({ bid: 'B12', ch: 'EP', day: 65, min: H(14, 10), amt: 350000 }); },
  };
  const ALL: PayCh[] = ['EP', 'JC', 'CA', 'RA'];
  for (const ins of insts) {
    if (ins.due > TODAY) continue;
    if (SCRIPT[ins.id]) { SCRIPT[ins.id](); continue; }
    const b = B(ins.bid);
    const late = rnd() > b.onTime;
    const day = late ? ins.due + ri(1, 4) : ins.due - ri(0, 2);
    const ch = rnd() < 0.1 ? pick(ALL.filter(c => c !== b.ch)) : b.ch;
    const min = ri(H(8), H(21));
    const a = rnd();
    if (day > TODAY) continue;
    if (a < 0.03) {
      const part = Math.round((ins.amount * 0.6) / 10000) * 10000;
      addPay({ bid: b.id, ch, day, min, amt: part, anomaly: 'partial' });
      if (day + 2 <= TODAY) addPay({ bid: b.id, ch, day: day + 2, min: ri(H(8), H(21)), amt: ins.amount - part });
    } else if (a < 0.07) {
      addPay({ bid: b.id, ch, day, min, amt: ins.amount, status: 'failed', failReason: pick(FAILS), anomaly: 'failed' });
      addPay({ bid: b.id, ch, day, min: Math.min(min + ri(5, 40), H(23, 30)), amt: ins.amount });
    } else if (a < 0.12) {
      addPay({ bid: b.id, ch, day, min, amt: ins.amount, dupDelivery: true, anomaly: 'duplicate_delivery' });
    } else {
      addPay({ bid: b.id, ch, day, min, amt: ins.amount });
    }
  }
  const nOrph = 1 + (rnd() < 0.5 ? 1 : 0);
  for (let k = 0; k < nOrph; k++) {
    let ph: string;
    do { ph = '03' + ri(10, 49) + String(ri(1000000, 9999999)); } while (phones.has(ph));
    addPay({ bid: null, truthBid: null, ch: rnd() < 0.5 ? 'EP' : 'JC', day: ri(45, 68), min: ri(H(9), H(21)), amt: [150000, 200000, 250000, 300000][ri(0, 3)], phone: ph, name: pick(STRANGERS), ref: '', anomaly: 'orphan' });
  }

  // Bank statement: one settlement per channel-day (T+1), Raast credits the same day, one branch cash deposit.
  const batches = new Map<string, { ch: PayCh; day: number; gross: number; claw: number }>();
  const bk = (ch: PayCh, day: number) => {
    const k = ch + '|' + day;
    if (!batches.has(k)) batches.set(k, { ch, day, gross: 0, claw: 0 });
    return batches.get(k)!;
  };
  for (const p of pays) if (p.status === 'success' && p.ch !== 'RA') bk(p.ch, p.day).gross += p.amt;
  for (const p of pays) if (p.reversal) bk(p.ch, p.reversal.day).claw += p.amt;
  const bank: Omit<BankLine, 'id'>[] = [];
  for (const b of batches.values()) {
    if (b.day + 1 > TODAY) continue;
    const id = b.ch + '-SETL-' + iso(b.day);
    if (id === MISSING_BATCH) { truth.push({ kind: 'missing_deposit', key: id }); continue; }
    const fee = Math.round((b.gross * CH[b.ch].bps) / 10000);
    let amt = b.gross - fee - b.claw;
    if (id === SHORT_BATCH) { amt -= 15000; truth.push({ kind: 'short_settlement', key: id }); }
    bank.push({ day: b.day + 1, min: H(9) + ri(0, 50), amount: amt, ref: id, narration: CH[b.ch].name.toUpperCase() + ' SETTLEMENT ' + iso(b.day) });
  }
  for (const p of pays) if (p.ch === 'RA' && p.status === 'success') bank.push({ day: p.day, min: Math.min(p.min + 2, H(23, 59)), amount: p.amt, ref: 'RAAST-' + p.tid, narration: 'RAAST CR ' + p.tid + ' ' + p.name });
  const branch = { day: 65, min: H(11, 20), amount: 350000, ref: '', narration: 'CASH DEPOSIT BR-0412 SUKKUR' };
  bank.push(branch);
  bank.sort((a, b) => a.day - b.day || a.min - b.min);
  const bankLines: BankLine[] = bank.map((l, i) => ({ ...l, id: 'BK-' + String(i + 1).padStart(4, '0') }));
  const branchId = bankLines[bank.indexOf(branch)].id;
  truth.push({ kind: 'unexpected_deposit', key: branchId });

  // Raw events exactly as each channel would send them.
  const rawNoId: Omit<RawEvent, 'id'>[] = [];
  for (const p of pays) {
    rawNoId.push(mkRaw(p));
    if (p.dupDelivery) rawNoId.push({ ...mkRaw(p), min: Math.min(p.min + 3, H(23, 59)), redelivery: true });
    if (p.reversal) rawNoId.push(mkReversal(p));
  }
  rawNoId.sort((a, b) => a.day - b.day || a.min - b.min);
  const raw: RawEvent[] = rawNoId.map((r, i) => ({ ...r, id: 'RE-' + String(i + 1).padStart(5, '0') }));

  const truthByTid = new Map<string, TruthTag>();
  for (const p of pays) truthByTid.set(p.tid, { bid: p.truthBid, anomaly: p.anomaly });
  truthByTid.set(branchId, { bid: 'B07', anomaly: 'unexpected_deposit' });
  return { seed, borrowers, loans, insts, raw, bank: bankLines, truth, truthByTid };
}

function mkRaw(p: PaySpec): Omit<RawEvent, 'id'> {
  let payload: Record<string, unknown>;
  const at = stamp(p.day, p.min);
  if (p.ch === 'EP') payload = { event: p.status === 'success' ? 'payment.completed' : p.status === 'failed' ? 'payment.failed' : 'payment.pending', txn_id: p.tid, msisdn: p.phone, account_name: p.name, amount_pkr: amtStr(p.amt), note: p.ref, at };
  else if (p.ch === 'JC') payload = { type: p.status === 'success' ? 'TXN_SUCCESS' : p.status === 'failed' ? 'TXN_FAILED' : 'TXN_PENDING', ref_no: p.tid, mobile: p.phone, payer: p.name, amount: amtStr(p.amt), bill_ref: p.ref, ts: at };
  else if (p.ch === 'CA') payload = { receipt_no: p.tid, agent_id: 'AG-' + (110 + (p.tid.charCodeAt(4) % 30)), customer_ref: p.ref, customer_name: p.name, amount: amtStr(p.amt), status: p.status === 'success' ? 'COLLECTED' : 'VOID', collected_at: at };
  else payload = { raast_id: p.tid, status: p.status === 'success' ? 'CREDITED' : p.status === 'failed' ? 'REJECTED' : 'PENDING', sender_title: p.name, sender_iban: 'PK••••' + p.tid.slice(-4), remarks: p.ref, amount: amtStr(p.amt), at };
  if (p.status === 'failed') payload.reason = p.failReason;
  return { src: CH[p.ch].src, ch: p.ch, day: p.day, min: p.min, tid: p.tid, payload, key: p.ch + ':' + p.tid + ':' + p.status };
}
function mkReversal(p: PaySpec): Omit<RawEvent, 'id'> {
  const r = p.reversal!;
  return { src: CH[p.ch].src, ch: p.ch, day: r.day, min: r.min, tid: p.tid, payload: { event: 'payment.reversed', txn_id: p.tid, reason: r.reason, at: stamp(r.day, r.min) }, key: p.ch + ':' + p.tid + ':reversed' };
}
