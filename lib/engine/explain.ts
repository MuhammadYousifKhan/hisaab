// Every journal entry gets a plain sentence generated from its own numbers, in English or Urdu.
// Borrower-facing reasons have Urdu text; ops-only reasons (settlements, suspense) are English.
import { CH, KIND_LABEL, REASON_UR } from './data';
import type { Ch, Entry, Lang } from './types';
import { LTR, fmtDate, fmtRs, maskPhone } from './util';

function nos(list: number[] | undefined, lang: Lang): string {
  const xs = Array.from(new Set(list || []));
  if (!xs.length) return '';
  if (lang === 'ur') return xs.join(' اور ');
  if (xs.length === 1) return '#' + xs[0];
  return xs.slice(0, -1).map(n => '#' + n).join(', ') + ' and #' + xs[xs.length - 1];
}

export function explain(e: Entry, lang: Lang = 'en'): string {
  const p = e.params, ur = lang === 'ur';
  const R = (v: number | undefined) => fmtRs(v ?? 0, lang);
  const D = (d: number | undefined) => fmtDate(d ?? 0, lang);
  const C = (ch: Ch | undefined) => (ch && CH[ch] ? (ur ? CH[ch].ur : CH[ch].name) : String(ch ?? ''));
  const applied = p.applied || [];
  const last = applied[applied.length - 1];
  const appliedNos = applied.map(a => a.no);
  const appliedSum = applied.reduce((s, a) => s + a.amt, 0);
  switch (e.reason) {
    case 'LOAN_DISBURSED':
      return ur
        ? R(p.principal) + ' کا قرض شروع ہوا۔ کل ' + R(p.total) + ' واپس کرنے ہیں، ' + p.n + ' ہفتہ وار اقساط میں، جس میں ' + R(p.fee) + ' سروس چارج شامل ہے۔'
        : 'Loan of ' + R(p.principal) + ' started: ' + R(p.total) + ' to repay in ' + p.n + ' weekly installments, including a ' + R(p.fee) + ' service charge.';
    case 'PAYMENT_APPLIED':
      return ur
        ? D(p.payDay) + ' کو ' + C(p.ch) + ' سے ادا کیے گئے ' + R(p.amount) + ' سے قسط نمبر ' + nos(appliedNos, 'ur') + ' ادا ہو گئی۔'
        : R(p.amount) + ' via ' + C(p.ch) + ' on ' + D(p.payDay) + ' paid installment ' + nos(appliedNos, 'en') + '.';
    case 'PARTIAL_PAYMENT':
      return ur
        ? D(p.payDay) + ' کو ' + C(p.ch) + ' سے ' + R(p.amount) + ' قسط نمبر ' + last.no + ' میں جمع ہوئے۔ اس قسط کے ' + R(last.left) + ' ابھی باقی ہیں۔'
        : R(p.amount) + ' via ' + C(p.ch) + ' on ' + D(p.payDay) + ' went to installment #' + last.no + '. ' + R(last.left) + ' of it is still due.';
    case 'OVERPAYMENT_CREDIT':
      if (!applied.length) {
        return ur
          ? D(p.payDay) + ' کو ' + C(p.ch) + ' سے ' + R(p.amount) + ' اس وقت آئے جب کوئی قسط واجب نہیں تھی، اس لیے یہ کریڈٹ کے طور پر محفوظ ہیں۔'
          : R(p.amount) + ' via ' + C(p.ch) + ' on ' + D(p.payDay) + ' arrived when nothing was due, so it was saved as credit.';
      }
      return ur
        ? D(p.payDay) + ' کو ' + C(p.ch) + ' سے ' + R(p.amount) + ' موصول ہوئے: ' + R(appliedSum) + ' سے قسط نمبر ' + nos(appliedNos, 'ur') + ' مکمل ہوئی اور زائد ' + R(p.excess) + ' آپ کی اگلی قسط کے لیے کریڈٹ کے طور پر محفوظ کر لیے گئے۔'
        : R(p.amount) + ' via ' + C(p.ch) + ' on ' + D(p.payDay) + ': ' + R(appliedSum) + ' completed installment ' + nos(appliedNos, 'en') + ' and the extra ' + R(p.excess) + ' was saved as credit for the next installment.';
    case 'CREDIT_APPLIED':
      return ur
        ? 'آپ کے محفوظ کریڈٹ میں سے ' + R(p.amt) + ' قسط نمبر ' + p.no + ' میں استعمال ہوئے۔'
        : R(p.amt) + ' of saved credit was used for installment #' + p.no + '.';
    case 'CHANNEL_REVERSAL': {
      const why = ur ? REASON_UR[p.reason ?? ''] || p.reason : p.reason;
      if (!p.nos || !p.nos.length) {
        return ur
          ? C(p.ch) + ' نے ' + D(p.payDay) + ' والی ' + R(p.amount) + ' کی ادائیگی واپس کر دی (' + why + ')۔'
          : C(p.ch) + ' reversed the ' + R(p.amount) + ' payment from ' + D(p.payDay) + ' (' + why + '). The amount held in suspense was released.';
      }
      return ur
        ? C(p.ch) + ' نے ' + D(p.payDay) + ' والی ' + R(p.amount) + ' کی ادائیگی واپس کر دی (' + why + ')۔ قسط نمبر ' + nos(p.nos, 'ur') + ' دوبارہ واجب ہے۔'
        : C(p.ch) + ' reversed the ' + R(p.amount) + ' payment from ' + D(p.payDay) + ' (' + why + '). Installment ' + nos(p.nos, 'en') + ' is open again.';
    }
    case 'SUSPENSE_APPLIED': {
      const where = ur
        ? (appliedNos.length ? 'قسط نمبر ' + nos(appliedNos, 'ur') : '') + (p.excess ? (appliedNos.length ? '، اور ' : '') + R(p.excess) + ' کریڈٹ میں' : '')
        : (appliedNos.length ? 'installment ' + nos(appliedNos, 'en') : '') + (p.excess ? (appliedNos.length ? ', with ' : '') + R(p.excess) + ' saved as credit' : '');
      if (p.kind === 'orphan_payment') {
        return ur
          ? D(p.payDay) + ' کو دوسرے نمبر (' + LTR(maskPhone(p.phone)) + ') سے ادا کیے گئے ' + R(p.amount) + ' جانچ کے بعد آپ کے قرض میں جمع کر دیے گئے: ' + where + '۔'
          : R(p.amount) + ' paid on ' + D(p.payDay) + ' from another number (' + maskPhone(p.phone) + ') was checked and added to your loan: ' + where + '.';
      }
      if (p.kind === 'reference_conflict') {
        return ur
          ? D(p.payDay) + ' کو حوالہ ' + LTR('"' + p.ref + '"') + ' کے ساتھ بھیجے گئے ' + R(p.amount) + ' جانچ کے بعد آپ کے قرض میں جمع کر دیے گئے: ' + where + '۔'
          : R(p.amount) + ' sent on ' + D(p.payDay) + ' with reference "' + p.ref + '" was checked and added to your loan: ' + where + '.';
      }
      if (p.kind === 'unexpected_deposit') {
        return ur
          ? D(p.payDay) + ' کو بینک برانچ میں جمع کرائے گئے ' + R(p.amount) + ' جانچ کے بعد آپ کے قرض میں جمع کر دیے گئے: ' + where + '۔'
          : R(p.amount) + ' deposited at the bank branch on ' + D(p.payDay) + ' was checked and added to your loan: ' + where + '.';
      }
      return ur
        ? D(p.payDay) + ' کو آپ کی دوسری ' + R(p.amount) + ' کی ادائیگی اضافی ادائیگی کے طور پر رکھی گئی: ' + where + '۔'
        : 'Your second ' + R(p.amount) + ' payment on ' + D(p.payDay) + ' was kept as an extra payment: ' + where + '.';
    }
    case 'REFUND_DUE':
      if (!p.bid) return 'The ' + R(p.amount) + ' payment from ' + D(p.payDay) + ' could not be linked to any borrower and is marked for refund to the sender.';
      return ur
        ? D(p.payDay) + ' کو ' + R(p.amount) + ' دو بار ادا ہوئے۔ اضافی ادائیگی آپ کو واپس کرنے کے لیے درج کر لی گئی ہے۔'
        : R(p.amount) + ' was paid twice on ' + D(p.payDay) + '. The extra payment is marked for refund to you.';
    case 'SUSPENSE_RECEIPT':
      return R(p.amount) + ' via ' + C(p.ch) + ' on ' + D(p.payDay) + ' could not be matched safely (' + (p.kind ? KIND_LABEL[p.kind] : 'unknown').toLowerCase() + '). It is held in suspense until someone reviews it.';
    case 'SETTLEMENT':
    case 'SETTLEMENT_SHORT':
    case 'SETTLEMENT_OVER': {
      let s: string;
      if (p.ch === 'RA') s = 'Raast transfer ' + (p.batch ?? '').slice(3) + ' reached the bank: ' + R(p.net) + '.';
      else {
        s = C(p.ch) + ' settled ' + p.count + ' payment' + (p.count === 1 ? '' : 's') + ' from ' + D(p.batchDay) + ' totalling ' + R(p.gross);
        if (p.fee) s += ', minus a ' + ((p.bps ?? 0) / 100).toFixed(1) + '% fee of ' + R(p.fee);
        if (p.clawback) s += ', minus ' + R(p.clawback) + ' for a reversed payment';
        s += '. The bank received ' + R(p.net) + '.';
      }
      const diff = p.diff ?? 0;
      if (diff > 0) s += ' That is ' + R(diff) + ' less than expected, so the gap is recorded as a claim on ' + C(p.ch) + '.';
      if (diff < 0) s += ' That is ' + R(-diff) + ' more than expected; the extra is held in suspense.';
      return s;
    }
    case 'FEE_ACCEPTED':
      return 'The ' + R(p.diff) + ' gap in the ' + C(p.ch) + ' settlement of ' + D(p.batchDay) + ' was accepted as an extra channel fee.';
    case 'CLAIM_RECOVERED': {
      const how = p.line && /^BK-/.test(p.line) ? ' (bank line ' + p.line + ')' : '';
      let s = C(p.ch) + ' paid back ' + R(p.amount) + how + ' towards the ' + R(p.diff) + ' shortfall in its settlement of ' + D(p.batchDay) + '.';
      s += p.left ? ' ' + R(p.left) + ' is still claimed.' : ' The claim is closed.';
      return s;
    }
    case 'CHANNEL_RETURN_DUE':
      return 'The extra ' + R(p.amount) + ' in the ' + C(p.ch) + ' settlement of ' + D(p.batchDay) + ' is owed back to ' + C(p.ch) + ', so it moved from suspense to amounts to pay out.';
    case 'REFUND_PAID': {
      const ref = p.payRef ? (ur ? ' (حوالہ ' + LTR(p.payRef) + ')' : ' (reference ' + p.payRef + ')') : '';
      if (p.bid) {
        return ur
          ? D(p.payDay) + ' والی ' + R(p.amount) + ' کی اضافی ادائیگی آپ کو واپس کر دی گئی' + ref + '۔'
          : 'The extra ' + R(p.amount) + ' you paid on ' + D(p.payDay) + ' was refunded to you' + ref + '.';
      }
      if (p.batch) return R(p.amount) + ' was paid back to ' + C(p.ch) + ' for its settlement of ' + D(p.batchDay) + ref + '.';
      return 'The ' + R(p.amount) + ' payment from ' + D(p.payDay) + ' was refunded to the sender' + ref + '.';
    }
    default:
      return '';
  }
}
