// Channel payloads exactly as each provider sends them, and the few fields we read before validation
// (transaction ID, status, timestamp) to build the idempotency key. Full validation happens in the
// engine's adapters, so a malformed payload is still stored as received and then quarantined.
import type { PayCh, PayStatus, RawEvent } from '@/lib/engine';
import { CH, amtStr, parseStamp, stamp } from '@/lib/engine';

export const SLUG_TO_CH: Record<string, PayCh> = { easypaisa: 'EP', jazzcash: 'JC', agent: 'CA', raast: 'RA' };
export const CH_TO_SLUG: Record<PayCh, string> = { EP: 'easypaisa', JC: 'jazzcash', CA: 'agent', RA: 'raast' };

export interface PaymentSpec {
  ch: PayCh; tid: string; amount: number; phone: string | null; name: string; ref: string;
  status: PayStatus; failReason?: string | null; day: number; min: number; agentId?: string;
}

/** The JSON body a channel would POST for a payment. Mirrors the demo generator's shapes. */
export function paymentPayload(p: PaymentSpec): Record<string, unknown> {
  const at = stamp(p.day, p.min);
  let payload: Record<string, unknown>;
  if (p.ch === 'EP') payload = { event: p.status === 'success' ? 'payment.completed' : p.status === 'failed' ? 'payment.failed' : 'payment.pending', txn_id: p.tid, msisdn: p.phone, account_name: p.name, amount_pkr: amtStr(p.amount), note: p.ref, at };
  else if (p.ch === 'JC') payload = { type: p.status === 'success' ? 'TXN_SUCCESS' : p.status === 'failed' ? 'TXN_FAILED' : 'TXN_PENDING', ref_no: p.tid, mobile: p.phone, payer: p.name, amount: amtStr(p.amount), bill_ref: p.ref, ts: at };
  else if (p.ch === 'CA') payload = { receipt_no: p.tid, agent_id: p.agentId || 'AG-110', customer_ref: p.ref, customer_name: p.name, amount: amtStr(p.amount), status: p.status === 'success' ? 'COLLECTED' : 'VOID', collected_at: at };
  else payload = { raast_id: p.tid, status: p.status === 'success' ? 'CREDITED' : p.status === 'failed' ? 'REJECTED' : 'PENDING', sender_title: p.name, sender_iban: 'PK••••' + p.tid.slice(-4), remarks: p.ref, amount: amtStr(p.amount), at };
  if (p.status === 'failed') payload.reason = p.failReason || 'Declined by channel';
  return payload;
}

export function reversalPayload(tid: string, reason: string, day: number, min: number): Record<string, unknown> {
  return { event: 'payment.reversed', txn_id: tid, reason, at: stamp(day, min) };
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
/** Small stable hash, used only to key payloads too broken to carry a transaction ID. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface Described { tid: string; status: string; key: string; day: number; min: number; stamped: boolean }

/** Pull the transaction ID, status and time out of a payload as received. Never throws. */
export function describePayload(ch: PayCh, payload: Record<string, unknown>, recv: { day: number; min: number }): Described {
  let tid = '', status = '', when: unknown;
  if (payload.event === 'payment.reversed') { tid = str(payload.txn_id); status = 'reversed'; when = payload.at; }
  else if (ch === 'EP') {
    tid = str(payload.txn_id); when = payload.at;
    status = ({ 'payment.completed': 'success', 'payment.failed': 'failed', 'payment.pending': 'pending' } as Record<string, string>)[str(payload.event)] || '';
  } else if (ch === 'JC') {
    tid = str(payload.ref_no); when = payload.ts;
    status = ({ TXN_SUCCESS: 'success', TXN_FAILED: 'failed', TXN_PENDING: 'pending' } as Record<string, string>)[str(payload.type)] || '';
  } else if (ch === 'CA') {
    tid = str(payload.receipt_no); when = payload.collected_at;
    status = ({ COLLECTED: 'success', VOID: 'failed' } as Record<string, string>)[str(payload.status)] || '';
  } else {
    tid = str(payload.raast_id); when = payload.at;
    status = ({ CREDITED: 'success', REJECTED: 'failed', PENDING: 'pending' } as Record<string, string>)[str(payload.status)] || '';
  }
  // A payment can't happen after it reached us: a future timestamp (clock skew, bad data) falls back to the arrival time.
  let t = parseStamp(when);
  if (t && (t.day > recv.day || (t.day === recv.day && t.min > recv.min))) t = null;
  const key = tid && status ? ch + ':' + tid + ':' + status : ch + ':invalid:' + fnv(JSON.stringify(payload));
  return { tid: tid || 'UNKNOWN', status: status || 'invalid', key, day: t ? t.day : recv.day, min: t ? t.min : recv.min, stamped: !!t };
}

/** A stored raw event for a live book (id and ord are assigned when it is written). */
export function rawEventFor(ch: PayCh, payload: Record<string, unknown>, recv: { day: number; min: number }): Omit<RawEvent, 'id' | 'ord'> {
  const d = describePayload(ch, payload, recv);
  return { src: CH[ch].src, ch, day: d.day, min: d.min, tid: d.tid, key: d.key, payload, recvDay: recv.day, recvMin: recv.min };
}
