import type { AcctCode, AcctType, Ch, ExKind, PayCh } from './types';

// Channel fee rates in basis points.
export const CH: Record<Ch, { name: string; ur: string; bps: number; src: string }> = {
  EP: { name: 'Easypaisa', ur: 'ایزی پیسہ', bps: 120, src: 'Easypaisa webhook' },
  JC: { name: 'JazzCash', ur: 'جاز کیش', bps: 150, src: 'JazzCash webhook' },
  CA: { name: 'Cash agent', ur: 'کیش ایجنٹ', bps: 100, src: 'Agent network CSV' },
  RA: { name: 'Raast transfer', ur: 'راست ٹرانسفر', bps: 0, src: 'Bank Raast feed' },
  BR: { name: 'Bank branch deposit', ur: 'بینک برانچ جمع', bps: 0, src: 'Bank statement' },
};
export const CLR: Record<PayCh, AcctCode> = { EP: '1101', JC: '1102', CA: '1103', RA: '1104' };
export const CLEARING: AcctCode[] = ['1101', '1102', '1103', '1104'];

export const ACCTS: Record<AcctCode, { name: string; type: AcctType }> = {
  '1000': { name: 'Bank account', type: 'asset' },
  '1101': { name: 'Clearing · Easypaisa', type: 'asset' },
  '1102': { name: 'Clearing · JazzCash', type: 'asset' },
  '1103': { name: 'Clearing · Cash agents', type: 'asset' },
  '1104': { name: 'Clearing · Raast', type: 'asset' },
  '1200': { name: 'Loans receivable', type: 'asset' },
  '1300': { name: 'Claims on channels', type: 'asset' },
  '2000': { name: 'Borrower credit balances', type: 'liability' },
  '2100': { name: 'Unidentified receipts (suspense)', type: 'liability' },
  '2200': { name: 'Refunds payable', type: 'liability' },
  '3000': { name: 'Loan capital deployed', type: 'equity' },
  '4000': { name: 'Service charge income', type: 'income' },
  '5000': { name: 'Channel fee expense', type: 'expense' },
};

export const KIND_LABEL: Record<ExKind, string> = {
  orphan_payment: 'Payment from an unknown sender',
  reference_conflict: 'Reference points to another loan',
  possible_duplicate: 'Possible double payment',
  reversal: 'Payment reversed by channel',
  unexpected_deposit: 'Bank deposit with no payment record',
  missing_deposit: 'Settlement not received',
  settlement_short: 'Settlement less than expected',
  settlement_over: 'Settlement more than expected',
  borrower_report: 'Borrower says a payment is missing',
};
export const KCODE: Partial<Record<ExKind, string>> = { orphan_payment: 'ORP', reference_conflict: 'REF', possible_duplicate: 'DUP', unexpected_deposit: 'UNX' };

export const REASON_UR: Record<string, string> = {
  'Disputed by account holder': 'اکاؤنٹ ہولڈر نے اعتراض کیا',
  'Insufficient wallet balance': 'والیٹ میں رقم کم تھی',
  'Wrong PIN entered': 'غلط پن درج ہوا',
  'Network timeout': 'نیٹ ورک کا مسئلہ',
};

export const REASON_LABEL: Record<string, string> = {
  LOAN_DISBURSED: 'Loan started', PAYMENT_APPLIED: 'Payment applied', PARTIAL_PAYMENT: 'Partial payment', OVERPAYMENT_CREDIT: 'Overpayment to credit',
  CREDIT_APPLIED: 'Credit used', CHANNEL_REVERSAL: 'Channel reversal', SUSPENSE_APPLIED: 'Held payment applied', REFUND_DUE: 'Refund due',
  SUSPENSE_RECEIPT: 'Held for review', SETTLEMENT: 'Settlement', SETTLEMENT_SHORT: 'Short settlement', SETTLEMENT_OVER: 'Over settlement', FEE_ACCEPTED: 'Fee accepted',
};

export const SYS = 'system: matcher';
export const OPS = 'ops: staff';
