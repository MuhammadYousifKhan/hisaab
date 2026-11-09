// Shared types for the Hisaab engine. All money is integer paisa (Rs 1 = 100).

export type PayCh = 'EP' | 'JC' | 'CA' | 'RA';
export type Ch = PayCh | 'BR';
export type Lang = 'en' | 'ur';
export type AcctCode = '1000' | '1101' | '1102' | '1103' | '1104' | '1200' | '1300' | '2000' | '2100' | '2200' | '3000' | '4000' | '5000';
export type AcctType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

/** Who a borrower is, as entered when their account was opened. */
export interface BorrowerBase {
  id: string; name: string; ur: string; work: string; workUr: string; city: string; phone: string; ch: PayCh;
}
export interface Borrower extends BorrowerBase { loanId: string | null }
export interface Loan { id: string; bid: string; principal: number; fee: number; total: number; n: number; instAmt: number; start: number }
export interface InstallmentPart { tid: string | null; amt: number; day: number }
export interface Installment {
  id: string; loanId: string; bid: string; no: number; due: number; amount: number;
  paid: number; parts: InstallmentPart[]; fullDay: number | null;
}

/** Arrival stamp of a live input: per-book arrival number, and the Pakistan-time day and minute it arrived. */
export interface Arrival { ord?: number; recvDay?: number; recvMin?: number }
/** day/min are the channel's own timestamp for the payment; the arrival stamp says when it reached us. */
export interface RawEvent extends Arrival {
  id: string; src: string; ch: PayCh; day: number; min: number; tid: string;
  payload: Record<string, unknown>; key: string; redelivery?: boolean;
}
/** key is the dedupe key: the bank's own reference, or a hash of the line. */
export interface BankLine extends Arrival { id: string; day: number; min: number; amount: number; ref: string; narration: string; key?: string }

export type PayStatus = 'success' | 'failed' | 'pending';
export type TxnState = 'applied' | 'held' | 'failed' | 'pending' | 'reversed' | 'refund_due';
export interface Suggest { bid: string; why: string }
export interface Txn {
  tid: string; ch: Ch; day: number; min: number; amount: number; phone: string | null; name: string | null; ref: string;
  status: PayStatus; failReason: string | null; rawId: string;
  borrowerId: string | null; rule: string | null; conf: number; autoRule: string | null; autoBid: string | null;
  state: TxnState | null; batchId: string | null; settled: boolean; settleDay: number | null; batchLate: boolean;
  exId: string | null; suggest: Suggest | null; reversed: { day: number; min: number; reason: string; rawId: string } | null;
  entries: string[]; heldOnce: boolean;
}

export interface Batch {
  id: string; ch: Ch; day: number; txns: string[]; gross: number; clawback: number; claws: string[];
  settled: boolean; settleDay: number | null; received: number | null; fee: number | null; expectedNet: number | null;
  diff: number | null; lineId: string | null; exId: string | null; late: boolean; entry: string | null;
}

export interface Applied { no: number; amt: number; left: number }
export interface EntryParams {
  bid?: string | null; loan?: string; principal?: number; fee?: number; total?: number; n?: number;
  amt?: number; no?: number; tid?: string; ch?: Ch; amount?: number; payDay?: number; applied?: Applied[]; excess?: number;
  phone?: string | null; ref?: string; kind?: ExKind; reason?: string; nos?: number[];
  batch?: string; batchDay?: number; count?: number; gross?: number; bps?: number; clawback?: number; net?: number;
  expectedNet?: number; diff?: number; line?: string;
}
export interface LineIn { acct: AcctCode; sub?: string | null; dr?: number; cr?: number }
export interface Line { acct: AcctCode; sub: string | null; dr: number; cr: number }
export interface Entry {
  id: string; day: number; reason: string; params: EntryParams; lines: Line[]; src: string[]; actor: string;
  total: number; reverses: string | null; reversedBy: string | null;
}
export interface PostInput { day: number; reason: string; params?: EntryParams; lines: LineIn[]; src?: string[]; actor?: string; reverses?: string | null }
export interface Ledger {
  entries: Entry[]; bal: Map<string, number>;
  post(o: PostInput): Entry;
  balance(acct: AcctCode, sub?: string | null): number;
}

export type ExKind =
  | 'orphan_payment' | 'reference_conflict' | 'possible_duplicate' | 'reversal' | 'unexpected_deposit'
  | 'missing_deposit' | 'settlement_short' | 'settlement_over' | 'borrower_report';
export type ExStatus = 'open' | 'claimed' | 'resolved';
export interface Resolution { action: string; je: string | null; note: string; by: string; day: number }
export interface Exception {
  id: string; kind: ExKind; key: string; day: number; amount: number; status: ExStatus;
  tid?: string | null; bid?: string | null; suggest?: Suggest | null; ch?: Ch;
  refBid?: string; dupOf?: string; reason?: string; nos?: number[]; batch?: string; lineId?: string;
  claim?: { day: number; by: string }; resolution?: Resolution;
  payDay?: number; reportedTid?: string; finding?: string; linked?: string | null;
}

/** Human input. `at` is the day it was recorded and `by` who recorded it. */
export type Action = (
  | { type: 'report'; n: number; bid: string; ch: Ch; amount: number; day: number; tid: string }
  | { type: 'apply'; exId: string; bid: string }
  | { type: 'refund' | 'accept_fee' | 'claim' | 'ack'; exId: string }
) & { at?: number; by?: string; ord?: number };

export interface Quarantined { re: RawEvent; error: string }

/** A borrower as stored. */
export interface BorrowerIn extends BorrowerBase { ord: number; recvDay: number }
/** A loan as issued. firstDue is the first weekly due day; amounts are paisa. */
export interface LoanIn { ord: number; recvDay: number; id: string; bid: string; principal: number; fee: number; n: number; firstDue: number }
export interface LiveInputs {
  today: number; borrowers: BorrowerIn[]; loans: LoanIn[]; raw: RawEvent[]; bank: BankLine[]; actions: Action[];
}

export interface State {
  today: number; borrowers: Borrower[]; loans: Loan[]; insts: Installment[];
  raw: RawEvent[]; bank: BankLine[];
  ledger: Ledger; txns: Map<string, Txn>; txnList: Txn[]; batches: Map<string, Batch>;
  exceptions: Exception[]; exById: Map<string, Exception>; notes: { day: number; by: string; text: string; ex?: string }[];
  seenRaw: Set<string>; seenBank: Set<string>; ignored: (RawEvent | BankLine)[]; quarantined: Quarantined[]; accepted: number;
  rawById: Map<string, RawEvent>; bankById: Map<string, BankLine>; reports: Exception[]; cur: number;
  bById: Map<string, Borrower>; loanById: Map<string, Loan>; loanByBid: Map<string, Loan>;
  phoneIdx: Map<string, string>; nameIdx: Map<string, string>; nameDup: Set<string>;
}
