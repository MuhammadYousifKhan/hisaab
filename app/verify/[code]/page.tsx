import type { Metadata } from 'next';
import Link from 'next/link';
import { Money, Pill } from '@/components/ui';
import { loadState } from '@/lib/db/store';
import { borrowerSummary, fmtDate } from '@/lib/engine';
import type { Lang } from '@/lib/engine';
import { parseLang } from '@/lib/i18n';
import { readRecordCode } from '@/lib/record';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Repayment record', robots: { index: false, follow: false } };

const T = {
  en: {
    title: 'Repayment record', checked: 'Checked against the lender’s ledger', at: 'Recomputed {date}, when this page was opened',
    bad: 'This link is not valid', badLead: 'It may have been copied incompletely. Ask the borrower to share it again from their app.',
    noLoan: 'No loan has been issued to this person yet, so there is no repayment record.',
    loan: 'Loan', loanVal: '{n} weekly installments, from {date}',
    due: 'Installments due so far', paid: 'Paid in full', onTime: 'Paid on time', late: 'Paid late', overdue: 'Not yet paid and past due',
    streak: 'On time in a row', repaid: 'Total repaid', status: 'Status',
    sDone: 'Fully repaid', sBehind: 'Behind', sGood: 'Up to date',
    note: 'This shows what happened with this one lender, as recorded in its double-entry ledger: every payment was matched to the lender’s bank statement. It is a record, not a credit score, and it says nothing about future payments.',
  },
  ur: {
    title: 'ادائیگی کا ریکارڈ', checked: 'ادارے کے کھاتے سے جانچا گیا', at: '{date} کو، یہ صفحہ کھلنے پر دوبارہ حساب کیا گیا',
    bad: 'یہ لنک درست نہیں', badLead: 'ہو سکتا ہے یہ پورا کاپی نہ ہوا ہو۔ قرض دار سے کہیں کہ اپنی ایپ سے دوبارہ بھیجیں۔',
    noLoan: 'اس شخص کو ابھی کوئی قرض جاری نہیں ہوا، اس لیے ادائیگی کا کوئی ریکارڈ نہیں۔',
    loan: 'قرض', loanVal: '{n} ہفتہ وار اقساط میں، {date} سے',
    due: 'اب تک واجب اقساط', paid: 'مکمل ادا', onTime: 'وقت پر ادا', late: 'تاخیر سے ادا', overdue: 'تاریخ گزر گئی، ابھی ادا نہیں',
    streak: 'مسلسل وقت پر', repaid: 'کل واپس ادا', status: 'صورتحال',
    sDone: 'مکمل ادا ہو چکا', sBehind: 'پیچھے', sGood: 'باقاعدہ',
    note: 'یہ صرف اس ایک ادارے کے ساتھ ریکارڈ ہے، جیسا اس کے ڈبل انٹری کھاتے میں درج ہے: ہر ادائیگی ادارے کے بینک اسٹیٹمنٹ سے ملائی گئی۔ یہ ریکارڈ ہے، کریڈٹ اسکور نہیں، اور آئندہ ادائیگیوں کے بارے میں کچھ نہیں کہتا۔',
  },
} as const;
type Key = keyof typeof T.en;
const t = (lang: Lang, k: Key, p: Record<string, string> = {}) => T[lang][k].replace(/\{(\w+)\}/g, (m, x) => p[x] ?? m);

export default async function VerifyPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { code } = await params;
  const lang = parseLang((await searchParams).lang);
  const ur = lang === 'ur';
  const who = readRecordCode(decodeURIComponent(code));
  const L = who ? await loadState({ bookId: who.bookId }) : null;
  const ok = !!who && !!L && L.book.id === who.bookId && L.S.bById.has(who.bid);
  const langs = (
    <div className="lang" role="group" aria-label="Language">
      <Link href={'/verify/' + code} lang="en" aria-current={!ur ? 'true' : undefined}>EN</Link>
      <Link href={'/verify/' + code + '?lang=ur'} lang="ur" aria-current={ur ? 'true' : undefined}>اردو</Link>
    </div>
  );
  if (!ok) {
    return (
      <section className="panel verify" dir={ur ? 'rtl' : 'ltr'} lang={lang}>
        <div className="row"><h2>{t(lang, 'bad')}</h2>{langs}</div>
        <p className="muted">{t(lang, 'badLead')}</p>
      </section>
    );
  }
  const S = L!.S, sum = borrowerSummary(S, who!.bid), r = sum.record, b = sum.b;
  // Only the first name is shown: no surname, phone number, work or city.
  const name = (ur && b.ur ? b.ur : b.name).split(/\s+/).filter(Boolean)[0] ?? '';
  const status = !sum.loan ? null : sum.owed <= 0 ? ['good', '✓', t(lang, 'sDone')] : sum.overdue.length ? ['crit', '!', t(lang, 'sBehind')] : ['good', '✓', t(lang, 'sGood')];
  const row = (k: Key, v: React.ReactNode) => <><dt>{t(lang, k)}</dt><dd>{v}</dd></>;
  return (
    <section className="panel verify" dir={ur ? 'rtl' : 'ltr'} lang={lang}>
      <div className="row"><h2>{t(lang, 'title')}</h2>{langs}</div>
      <p><Pill cls="good" icon="✓">{t(lang, 'checked')}</Pill></p>
      <p className="muted small">{t(lang, 'at', { date: fmtDate(S.today, lang, true) })}</p>
      <h3 className="mt">{name}</h3>
      {!sum.loan ? <p>{t(lang, 'noLoan')}</p> : (
        <dl className="facts verify-facts">
          {row('loan', <><Money v={sum.loan.total} lang={lang} /> · {t(lang, 'loanVal', { n: String(sum.loan.n), date: fmtDate(sum.loan.start, lang, true) })}</>)}
          {row('repaid', <Money v={r.repaid} lang={lang} />)}
          {row('due', <span className="num">{r.due}</span>)}
          {row('paid', <span className="num">{r.paid}</span>)}
          {row('onTime', <span className="num">{r.onTime}</span>)}
          {row('late', <span className="num">{r.late}</span>)}
          {row('overdue', <span className="num">{sum.overdue.length}</span>)}
          {row('streak', <span className="num">{r.streak}</span>)}
          {status && row('status', <Pill cls={status[0]} icon={status[1]}>{status[2]}</Pill>)}
        </dl>
      )}
      <p className="est-note mt">{t(lang, 'note')}</p>
    </section>
  );
}
