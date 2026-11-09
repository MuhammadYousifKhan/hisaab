// P2 · Data: channel adapters. Each channel sends a different payload shape; Zod parses it
// before anything reaches the ledger, and every adapter returns the same canonical record.
import { z } from 'zod';
import type { PayCh, PayStatus, RawEvent } from './types';
import { toPaisa } from './util';

const Money = z.string().regex(/^\d+\.\d{2}$/, 'amount must look like 5000.00');
const Id = z.string().min(4);

const Reversal = z.object({ event: z.literal('payment.reversed'), txn_id: Id, reason: z.string(), at: z.string() });
const Easypaisa = z.object({
  event: z.enum(['payment.completed', 'payment.failed', 'payment.pending']), txn_id: Id, msisdn: z.string().nullable(),
  account_name: z.string(), amount_pkr: Money, note: z.string(), at: z.string(), reason: z.string().nullish(),
});
const JazzCash = z.object({
  type: z.enum(['TXN_SUCCESS', 'TXN_FAILED', 'TXN_PENDING']), ref_no: Id, mobile: z.string().nullable(), payer: z.string(),
  amount: Money, bill_ref: z.string(), ts: z.string(), reason: z.string().nullish(),
});
const Agent = z.object({
  receipt_no: Id, agent_id: z.string(), customer_ref: z.string(), customer_name: z.string(), amount: Money,
  status: z.enum(['COLLECTED', 'VOID']), collected_at: z.string(), reason: z.string().nullish(),
});
const Raast = z.object({
  raast_id: Id, status: z.enum(['CREDITED', 'REJECTED', 'PENDING']), sender_title: z.string(), sender_iban: z.string(),
  remarks: z.string(), amount: Money, at: z.string(), reason: z.string().nullish(),
});

export interface CanonPayment {
  type: 'payment'; tid: string; ch: PayCh; day: number; min: number; rawId: string; amount: number;
  phone: string | null; name: string; ref: string; status: PayStatus; failReason: string | null;
}
export interface CanonReversal { type: 'reversal'; tid: string; ch: PayCh; day: number; min: number; rawId: string; reason: string }
export type Canon = CanonPayment | CanonReversal;

export function normalize(re: RawEvent): Canon {
  const base = { ch: re.ch, day: re.day, min: re.min, rawId: re.id };
  if (re.payload.event === 'payment.reversed') {
    const r = Reversal.parse(re.payload);
    return { type: 'reversal', tid: r.txn_id, reason: r.reason, ...base };
  }
  switch (re.ch) {
    case 'EP': {
      const p = Easypaisa.parse(re.payload);
      const status: PayStatus = p.event === 'payment.completed' ? 'success' : p.event === 'payment.failed' ? 'failed' : 'pending';
      return { type: 'payment', tid: p.txn_id, amount: toPaisa(p.amount_pkr), phone: p.msisdn, name: p.account_name, ref: p.note, status, failReason: p.reason ?? null, ...base };
    }
    case 'JC': {
      const p = JazzCash.parse(re.payload);
      const status: PayStatus = p.type === 'TXN_SUCCESS' ? 'success' : p.type === 'TXN_FAILED' ? 'failed' : 'pending';
      return { type: 'payment', tid: p.ref_no, amount: toPaisa(p.amount), phone: p.mobile, name: p.payer, ref: p.bill_ref, status, failReason: p.reason ?? null, ...base };
    }
    case 'CA': {
      const p = Agent.parse(re.payload);
      return { type: 'payment', tid: p.receipt_no, amount: toPaisa(p.amount), phone: null, name: p.customer_name, ref: p.customer_ref, status: p.status === 'COLLECTED' ? 'success' : 'failed', failReason: p.reason ?? null, ...base };
    }
    case 'RA': {
      const p = Raast.parse(re.payload);
      const status: PayStatus = p.status === 'CREDITED' ? 'success' : p.status === 'REJECTED' ? 'failed' : 'pending';
      return { type: 'payment', tid: p.raast_id, amount: toPaisa(p.amount), phone: null, name: p.sender_title, ref: p.remarks, status, failReason: p.reason ?? null, ...base };
    }
  }
}
