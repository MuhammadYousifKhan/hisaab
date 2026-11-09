import type { AcctCode, AcctType, Ch, ExKind, Person, PayCh, TruthKind } from './types';
import { iso } from './util';

// Fee rates are synthetic test values, in basis points.
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

export const TRUTH_LABEL: Record<TruthKind, [string, string]> = {
  orphan: ['Payment from an unknown number', 'Held in suspense, sent to review'],
  wrong_reference: ['Reference points to another loan', 'Held, borrower suggested from account name'],
  possible_duplicate: ['Paid twice with different IDs', 'Second one held for review'],
  duplicate_delivery: ['Same payment delivered twice', 'Second delivery ignored by the dedupe gate'],
  reversal: ['Reversed by the channel', 'Mirror entry posted, installment reopened'],
  failed: ['Failed payment', 'Tracked, no ledger entry'],
  pending: ['Transfer still pending', 'Tracked as memo, no ledger entry'],
  partial: ['Partial payment', 'Applied, remainder still due'],
  overpayment: ['Overpayment', 'Extra saved as borrower credit'],
  unexpected_deposit: ['Bank deposit with no record', 'Held in suspense, sent to review'],
  missing_deposit: ['Settlement never arrived', 'Flagged after T+1'],
  short_settlement: ['Settlement arrived short', 'Gap booked as a claim on the channel'],
};

// Synthetic people. Names, phones and amounts are invented.
export const PEOPLE: Person[] = [
  { id: 'B01', name: 'Ali Raza', ur: 'علی رضا', work: 'Rickshaw driver', workUr: 'رکشہ ڈرائیور', city: 'Sukkur', phone: '03001110101', ch: 'EP', n: 18, inst: 5000, principal: 80000, firstDue: 0, onTime: 0.9, tag: 'Split payment', story: 'Paid installment #10 in two parts: Rs 3,000 from his Easypaisa wallet and Rs 2,050 at a cash agent. The extra Rs 50 became credit for next week.' },
  { id: 'B02', name: 'Shazia Parveen', ur: 'شازیہ پروین', work: 'Home-based tailor', workUr: 'گھریلو درزن', city: 'Rohri', phone: '03451110202', ch: 'JC', n: 12, inst: 3000, principal: 32000, firstDue: 3, onTime: 0.9, tag: 'Paid from another phone', story: "Paid her 6 Nov installment from her sister Rubina's JazzCash number with the note \"silai shazia\". The lender cannot tell it is hers until she reports it." },
  { id: 'B03', name: 'Bilal Ahmed', ur: 'بلال احمد', work: 'Student, freelance designer', workUr: 'طالب علم، فری لانس ڈیزائنر', city: 'Khairpur', phone: '03121110303', ch: 'RA', n: 14, inst: 4500, principal: 56000, firstDue: 1, onTime: 0.88, tag: 'Wrong reference', story: 'Typed L08 instead of L03 in his Raast transfer. Loan L08 belongs to someone else, but the account title says Bilal Ahmed.' },
  { id: 'B04', name: 'Nasreen Akhtar', ur: 'نسرین اختر', work: 'Kiryana shop owner', workUr: 'کریانہ دکان دار', city: 'Sukkur', phone: '03011110404', ch: 'JC', n: 16, inst: 4000, principal: 57000, firstDue: 4, onTime: 0.92, tag: 'Paid twice', story: 'Her JazzCash app froze, so she paid again. Two payments of Rs 4,000 went through three minutes apart with different IDs.' },
  { id: 'B05', name: 'Kamran Ali', ur: 'کامران علی', work: 'Bike delivery rider', workUr: 'بائیک ڈیلیوری رائیڈر', city: 'Sukkur', phone: '03331110505', ch: 'EP', n: 12, inst: 3000, principal: 32000, firstDue: 6, onTime: 0.85, tag: 'Reversal', story: 'His 2 Nov Easypaisa payment was reversed on 5 Nov after the account holder disputed it, so installment #9 is open again.' },
  { id: 'B06', name: 'Hina Baloch', ur: 'حنا بلوچ', work: 'University student, home tutor', workUr: 'یونیورسٹی طالبہ، ہوم ٹیوٹر', city: 'Khairpur', phone: '03021110606', ch: 'JC', n: 10, inst: 2500, principal: 22000, firstDue: 2, onTime: 0.9, tag: 'Failed, then retried', story: 'Her first JazzCash attempt failed for low balance. She topped up and paid 25 minutes later.' },
  { id: 'B07', name: 'Zubair Shah', ur: 'زبیر شاہ', work: 'Vegetable cart vendor', workUr: 'سبزی ریڑھی والا', city: 'Sukkur', phone: '03061110707', ch: 'CA', n: 12, inst: 3500, principal: 37000, firstDue: 1, onTime: 0.85, tag: 'Cash at bank branch', story: 'Deposited Rs 3,500 cash straight at the bank branch instead of an agent. The bank shows money, but no channel record says whose it is.' },
  { id: 'B08', name: 'Farzana Kousar', ur: 'فرزانہ کوثر', work: 'Home beauty parlour', workUr: 'گھریلو بیوٹی پارلر', city: 'Rohri', phone: '03131110808', ch: 'RA', n: 12, inst: 4000, principal: 42000, firstDue: 6, onTime: 0.92, tag: 'Transfer pending', story: "Sent this morning's installment by Raast. The transfer is still processing at her bank, so it is not counted yet." },
  { id: 'B09', name: 'Imran Soomro', ur: 'عمران سومرو', work: 'Mobile repair shop', workUr: 'موبائل ریپئر دکان', city: 'Sukkur', phone: '03041110909', ch: 'EP', n: 14, inst: 3000, principal: 37000, firstDue: 5, onTime: 0.55, tag: 'Often late', story: 'Usually pays, but often a few days late. His record shows it honestly.' },
  { id: 'B10', name: 'Rukhsana Memon', ur: 'رخسانہ میمن', work: 'Rilli quilt maker', workUr: 'رلی بنانے والی', city: 'Shikarpur', phone: '03461111010', ch: 'CA', n: 12, inst: 2500, principal: 26000, firstDue: 3, onTime: 0.9, tag: 'Settlement missing', story: "Paid at a cash agent on 6 Nov. The agent network has not sent that day's cash to the lender's bank yet." },
  { id: 'B11', name: 'Asif Jatoi', ur: 'آصف جتوئی', work: 'Smallholder farmer', workUr: 'چھوٹا کسان', city: 'Larkana', phone: '03071111111', ch: 'CA', n: 10, inst: 4000, principal: 35000, firstDue: 3, onTime: 0.88, tag: 'Settlement missing', story: 'Same cash-agent batch as Rukhsana: paid on time, and the money is stuck with the agent network.' },
  { id: 'B12', name: 'Sadia Noor', ur: 'سعدیہ نور', work: 'Online clothing seller', workUr: 'آن لائن کپڑے فروش', city: 'Sukkur', phone: '03141111212', ch: 'EP', n: 16, inst: 3500, principal: 49000, firstDue: 2, onTime: 0.95, tag: 'On time', story: 'Pays on time every week by Easypaisa. Nothing goes wrong, which is what most rows look like.' },
];
export const STRANGERS = ['GHULAM MUSTAFA', 'SAJID HUSSAIN', 'TARIQ MEHMOOD', 'ABDUL GHAFFAR'];
export const FAILS = ['Insufficient wallet balance', 'Wrong PIN entered', 'Network timeout'];
export const MISSING_BATCH = 'CA-SETL-' + iso(66);
export const SHORT_BATCH = 'EP-SETL-' + iso(62);
export const SYS = 'system: matcher';
export const OPS = 'ops: Sana (finance)';
