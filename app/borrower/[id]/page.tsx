import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import CopySummary from '@/components/CopySummary';
import PersonaSelect from '@/components/PersonaSelect';
import ReportForm, { type ReportStrings } from '@/components/ReportForm';
import { Audience, Facts, Money, Pill } from '@/components/ui';
import { loadView, requireBorrowerView } from '@/lib/auth/viewer';
import { CH, REASON_UR, appliedInfo, borrowerSummary, explain, fmtDate, fmtNum, fmtRs, hhmm, maskPhone } from '@/lib/engine';
import type { BorrowerSummary, Ch, Entry, Exception, Lang, State, Txn } from '@/lib/engine';
import { CITY_UR, parseLang, tr, ts, type StrKey } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Borrower app' };

type Tab = 'home' | 'pay' | 'rec' | 'help';
const TABS: [Tab, StrKey][] = [['home', 'tabHome'], ['pay', 'tabPay'], ['rec', 'tabRec'], ['help', 'tabHelp']];

const CHOICES = [
  'Plain words. No “ledger”, “reconciliation” or “suspense” on a borrower’s screen.',
  'Urdu with a right-to-left layout and Nastaliq script. Amounts stay in the digits people see on receipts.',
  'Money has three states that never share a number: confirmed, on the way, and estimate. The estimate is dashed and labelled “not a promise”.',
  'Every balance change has a one-line reason, generated from the ledger entry’s own numbers.',
  'A missing payment can be reported from the phone with the SMS transaction ID. It reaches the lender’s review queue straight away.',
  'The repayment record turns matched payments into evidence of reliability for people who have no credit file.',
  'Large tap targets, text beside every symbol, no images, so it stays light on a low-end Android phone on slow data.',
];

export default async function BorrowerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const lang = parseLang(sp.lang);
  const tab: Tab = (['home', 'pay', 'rec', 'help'] as const).find(x => x === sp.tab) ?? 'home';
  const bid = id.toUpperCase();
  const session = await requireBorrowerView(bid, '/borrower/' + bid);
  const { S, book } = await loadView(session);
  // Staff who switched books land on a borrower list rather than a page from the other book.
  if (!S.bById.has(bid)) redirect(session.role === 'ops' ? '/borrower' : '/login');
  const staff = session.role === 'ops';
  const sum = borrowerSummary(S, bid);
  const b = sum.b, ur = lang === 'ur';
  const href = (o: { tab?: Tab; lang?: Lang; bid?: string }) => {
    const q = new URLSearchParams();
    const l = o.lang ?? lang, t = o.tab ?? tab;
    if (l === 'ur') q.set('lang', 'ur');
    if (t !== 'home') q.set('tab', t);
    const s = q.toString();
    return '/borrower/' + (o.bid ?? bid) + (s ? '?' + s : '');
  };
  const ctx: Ctx = { S, sum, lang, href, bookId: book.id };

  return (
    <>
      <Audience kind="borrower" />
      <div className="b-grid">
        <div className="phone-col">
          {staff && <PersonaSelect current={bid} lang={lang} options={S.borrowers.map(x => ({ id: x.id, label: x.name + ' · ' + (x.tag ?? x.id) }))} />}
          <div className="phone">
            <div className="app" dir={ur ? 'rtl' : 'ltr'} lang={ur ? 'ur' : 'en'}>
              <div className="app-head">
                <span className="avatar" aria-hidden="true">{initials(b.name)}</span>
                <div className="who">
                  <div className="hi">{ts(lang, 'greet', { name: ur ? b.ur : b.name.split(' ')[0] })}</div>
                  <div className="work">{ur ? b.workUr : b.work} · {ur ? CITY_UR[b.city] || b.city : b.city}</div>
                </div>
                <div className="lang" role="group" aria-label="Language">
                  <Link href={href({ lang: 'en' })} lang="en" aria-current={!ur ? 'true' : undefined} scroll={false}>EN</Link>
                  <Link href={href({ lang: 'ur' })} lang="ur" aria-current={ur ? 'true' : undefined} scroll={false}>اردو</Link>
                </div>
              </div>
              <nav className="app-tabs" aria-label={ur ? 'حصے' : 'Sections'}>
                {TABS.map(([k, l]) => <Link key={k} href={href({ tab: k })} aria-current={tab === k ? 'page' : undefined} scroll={false}>{ts(lang, l)}</Link>)}
              </nav>
              <div className="app-body">
                {tab === 'home' && <Home c={ctx} showAll={sp.all === '1'} />}
                {tab === 'pay' && <Payments c={ctx} />}
                {tab === 'rec' && <Record c={ctx} />}
                {tab === 'help' && <Help c={ctx} />}
              </div>
            </div>
          </div>
          <p className="phone-cap">{S.kind === 'demo' ? 'Synthetic borrower' : 'Live book'} · today is {fmtDate(S.today, 'en', true)}</p>
        </div>
        <aside className="why-col">
          <section className="panel">
            <p className="eyebrow">{staff ? 'Support view for lender staff' : 'Your account'}</p>
            <h2>{b.name}{b.work ? ', ' + b.work.toLowerCase() : ''}{b.city ? ' in ' + b.city : ''}</h2>
            {b.story && <p>{b.story}</p>}
            <Facts items={[
              ['Usually pays by', CH[b.ch].name],
              ['Registered phone', <span key="p" className="mono">{maskPhone(b.phone)}</span>],
              ['Loan', sum.loan ? sum.loan.id + ' · ' + fmtRs(sum.loan.total) + ' over ' + sum.loan.n + ' weeks' : 'No loan issued yet'],
              ['Credit file', 'None. The record in this app is the first one.'],
            ]} />
            {staff && <p><Link href={'/console?tab=people&b=' + b.id}>Manage this borrower in the console</Link></p>}
          </section>
          {staff && (
            <section className="panel">
              <h3>Switch borrower</h3>
              <p className="muted">{S.kind === 'demo' ? 'Each person carries one real-world payment problem from the challenge.' : 'Everyone in the live book, newest last.'}</p>
              <div className="persona-list">
                {S.borrowers.map(x => (
                  <Link key={x.id} className="persona" href={href({ bid: x.id, tab: 'home' })} aria-current={x.id === bid ? 'true' : undefined}>
                    <span className="avatar" aria-hidden="true">{initials(x.name)}</span>
                    <span><b>{x.name}</b><small>{[x.work, x.city].filter(Boolean).join(', ')}</small></span>
                    <span className="tag">{x.tag ?? x.id}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          <section className="panel">
            <h3>Designed for people with thin credit files</h3>
            <ul className="choices">{CHOICES.map(c => <li key={c}><span>{c}</span></li>)}</ul>
          </section>
        </aside>
      </div>
    </>
  );
}

interface Ctx { S: State; sum: BorrowerSummary; lang: Lang; href: (o: { tab?: Tab; lang?: Lang; bid?: string }) => string; bookId: number }
const initials = (n: string) => n.split(' ').filter(Boolean).map(s => s[0]).slice(0, 2).join('').toUpperCase();
const nosText = (list: number[], lang: Lang) => {
  const xs = Array.from(new Set(list));
  if (!xs.length) return '';
  if (lang === 'ur') return xs.join(' اور ');
  return xs.length === 1 ? '#' + xs[0] : xs.slice(0, -1).map(n => '#' + n).join(', ') + ' and #' + xs[xs.length - 1];
};
const chName = (ch: Ch, lang: Lang) => (lang === 'ur' ? CH[ch].ur : CH[ch].name);

function Home({ c, showAll }: { c: Ctx; showAll: boolean }) {
  const { sum, lang } = c;
  const ur = lang === 'ur';
  if (!sum.loan) return <section className="card"><h3>{ts(lang, 'noLoanTitle')}</h3><p className="muted">{ts(lang, 'noLoanLead')}</p></section>;
  const loan = sum.loan;
  const pct = Math.round((sum.paid / loan.total) * 100);
  const list = showAll ? sum.changes : sum.changes.slice(0, 4);
  const n = sum.next;
  return (
    <>
      <section className="owe" aria-label={ts(lang, 'owe')}>
        <div className="owe-lbl">{ts(lang, 'owe')}</div>
        <div className="big">{ur ? <><span className="num">{fmtNum(sum.owed)}</span> <small style={{ fontSize: 18 }}>روپے</small></> : <span className="num">Rs {fmtNum(sum.owed)}</span>}</div>
        <div className="meter" role="img" aria-label={ts(lang, 'meter', { pct })}><span style={{ width: pct + '%' }} /></div>
        <div className="owe-row"><span>{ts(lang, 'paidSoFar')}</span><b><Money v={sum.paid} lang={lang} /></b></div>
        <div className="owe-row"><span>{ts(lang, 'loanTotal')}</span><b><Money v={loan.total} lang={lang} /></b></div>
        {sum.onWay > 0 && <p className="owe-note">{tr(lang, 'onWayNote', { amt: <Money v={sum.onWay} lang={lang} /> })}</p>}
      </section>
      {sum.overdue.length > 0 && (
        <section className="card alert">
          <h3><Pill cls="crit" icon="!">{ts(lang, 'overdueTitle')}</Pill></h3>
          <ul className="plain">
            {sum.overdue.map(i => <li key={i.id}>{tr(lang, 'overdueRow', { no: i.no, date: fmtDate(i.due, lang), amt: <Money v={i.amount - i.paid} lang={lang} /> })}</li>)}
          </ul>
          <Link className="linkbtn" href={c.href({ tab: 'help' })} scroll={false}>{ts(lang, 'overdueHelp')} {ur ? '←' : '→'}</Link>
        </section>
      )}
      {n && (() => {
        const rem = n.amount - n.paid, use = Math.min(sum.credit, rem), pay = rem - use;
        return (
          <section className="card">
            <div className="row">
              <h3>{ts(lang, 'next')}</h3>
              {n.due === c.S.today ? <Pill cls="warn" icon="!">{ts(lang, 'dueToday')}</Pill> : <Pill cls="neutral" icon="◷">{ts(lang, 'dueOn', { date: fmtDate(n.due, lang) })}</Pill>}
            </div>
            <div className="next-amt"><Money v={pay} lang={lang} /></div>
            {use > 0 && <p className="muted">{tr(lang, 'creditUse', { credit: <Money v={use} lang={lang} />, pay: <Money v={pay} lang={lang} /> })}</p>}
            {n.paid > 0 && use === 0 && <p className="muted">{tr(lang, 'partPaid', { amt: <Money v={rem} lang={lang} /> })}</p>}
            <p className="muted">{ts(lang, 'instOf', { no: n.no, n: loan.n })}</p>
          </section>
        );
      })()}
      {sum.est ? (
        <section className="card est">
          <span className="est-tag"><span aria-hidden="true">≈</span> {ts(lang, 'estTag')}</span>
          <h3>{ts(lang, 'estTitle')}</h3>
          <p className="est-val">{ts(lang, 'estVal', { a: fmtDate(sum.est.a, lang, true), b: fmtDate(sum.est.b, lang, true) })}</p>
          <p className="est-note">{ts(lang, 'estNote')}</p>
        </section>
      ) : (
        <section className="card"><Pill cls="good" icon="✓">{ts(lang, 'doneTitle')}</Pill></section>
      )}
      <section className="card">
        <h3>{ts(lang, 'whyTitle')}</h3>
        <ul className="changes">{list.map(e => <Change key={e.id} e={e} bid={sum.b.id} lang={lang} />)}</ul>
        {sum.changes.length > 4 && (
          <Link className="linkbtn" href={showAll ? c.href({}) : c.href({}) + (c.href({}).includes('?') ? '&' : '?') + 'all=1'} scroll={false}>{showAll ? ts(lang, 'seeLess') : ts(lang, 'seeAll')}</Link>
        )}
      </section>
    </>
  );
}

function Change({ e, bid, lang }: { e: Entry; bid: string; lang: Lang }) {
  let loan = 0, credit = 0, refund = 0;
  for (const l of e.lines) {
    if (l.sub !== bid) continue;
    if (l.acct === '1200') loan += l.dr - l.cr;
    if (l.acct === '2000') credit += l.cr - l.dr;
    if (l.acct === '2200') refund += l.cr - l.dr;
  }
  const extras: ReactNode[] = [];
  if (credit) extras.push(tr(lang, 'creditDelta', { amt: <>{credit > 0 ? '+' : '−'}<Money v={Math.abs(credit)} lang={lang} /></> }));
  if (refund) extras.push(tr(lang, 'refundDelta', { amt: <Money v={refund} lang={lang} /> }));
  let delta: ReactNode = null;
  if (loan) delta = <span className={'delta ' + (loan < 0 ? 'down' : 'up')}>{loan < 0 ? '−' : '+'}<Money v={Math.abs(loan)} lang={lang} /></span>;
  else if (extras.length) delta = <span className="delta cr">{extras.shift()}</span>;
  return (
    <li>
      <span className="when">{fmtDate(e.day, lang)}</span>
      <span className="what">{explain(e, lang)}{extras.length > 0 && <><br /><span className="muted">{extras.map((x, i) => <span key={i}>{i ? ' · ' : ''}{x}</span>)}</span></>}</span>
      {delta}
    </li>
  );
}

function payState(p: Txn): [string, string, StrKey, string] {
  if (p.state === 'failed') return ['crit', '✕', 'st_failed', 'failed'];
  if (p.state === 'pending') return ['neutral', '…', 'st_processing', 'processing'];
  if (p.state === 'reversed') return ['crit', '↺', 'st_reversed', 'reversed'];
  if (p.state === 'refund_due') return ['warn', '↩', 'st_refund', 'refund'];
  if (p.state === 'held') return ['warn', '?', 'st_check', 'check'];
  if (p.settled) return ['good', '✓', 'st_confirmed', 'confirmed'];
  return ['info', '→', 'st_onway', 'onway'];
}
function Step({ cls, icon, children }: { cls: string; icon: string; children: ReactNode }) {
  return <li><span className={'dot ' + cls} aria-hidden="true">{icon}</span><span>{children}</span></li>;
}

function Payments({ c }: { c: Ctx }) {
  const { S, sum, lang } = c;
  if (!sum.pays.length) return <section className="card"><p>{ts(lang, 'payNone')}</p></section>;
  return (
    <>
      {sum.pays.map(p => {
        const [cls, icon, key, code] = payState(p);
        const sent = p.ch === 'BR' ? ts(lang, 's1br', { date: fmtDate(p.day, lang) }) : tr(lang, 's1', { ch: chName(p.ch, lang), date: fmtDate(p.day, lang), time: <span className="num">{hhmm(p.min)}</span> });
        const steps: ReactNode[] = [];
        if (p.state === 'failed') {
          const reason = lang === 'ur' ? REASON_UR[p.failReason || ''] || p.failReason : p.failReason;
          steps.push(<Step key="1" cls="bad" icon="✕">{sent}</Step>, <Step key="2" cls="bad" icon="!">{ts(lang, 'sFail', { reason: reason || '' })}</Step>);
        } else if (p.state === 'pending') {
          steps.push(<Step key="1" cls="done" icon="✓">{sent}</Step>, <Step key="2" cls="idle" icon="…">{ts(lang, 'sPend')}</Step>);
        } else {
          steps.push(<Step key="1" cls="done" icon="✓">{sent}</Step>);
          if (p.settled) steps.push(<Step key="2" cls="done" icon="✓">{ts(lang, 's2ok', { date: fmtDate(p.settleDay ?? p.day, lang) })}</Step>);
          else if (p.batchLate) steps.push(<Step key="2" cls="hold" icon="!">{ts(lang, 's2late', { ch: chName(p.ch, lang) })}</Step>);
          else steps.push(<Step key="2" cls="wait" icon="→">{ts(lang, 's2wait', { ch: chName(p.ch, lang) })}</Step>);
          if (p.state === 'applied') {
            const ai = appliedInfo(S, p);
            if (ai && ai.nos.length) steps.push(<Step key="3" cls="done" icon="✓">{ts(lang, 's3', { nos: nosText(ai.nos, lang) })}</Step>);
            if (ai && ai.excess) steps.push(<Step key="4" cls="done" icon="✓">{tr(lang, 's3credit', { amt: <Money v={ai.excess} lang={lang} /> })}</Step>);
          } else if (p.state === 'held') steps.push(<Step key="3" cls="hold" icon="?">{ts(lang, 's3hold')}</Step>);
          else if (p.state === 'reversed') steps.push(<Step key="3" cls="bad" icon="↺">{ts(lang, 'sRev', { ch: chName(p.ch, lang), date: fmtDate(p.reversed?.day ?? p.day, lang) })}</Step>);
          else if (p.state === 'refund_due') steps.push(<Step key="3" cls="hold" icon="↩">{ts(lang, 'sRefund')}</Step>);
        }
        return (
          <article key={p.tid} className="card pay">
            {code === 'confirmed' && <span className="stamp" aria-hidden="true">{ts(lang, 'stamp')}</span>}
            <div className="pay-top">
              <div>
                <div className="pay-amt"><Money v={p.amount} lang={lang} /></div>
                <div className="pay-meta">{chName(p.ch, lang)} · <span className="mono num">{p.tid}</span></div>
              </div>
              <Pill cls={cls} icon={icon}>{ts(lang, key)}</Pill>
            </div>
            <ol className="journey">{steps}</ol>
          </article>
        );
      })}
    </>
  );
}

function summaryText(sum: BorrowerSummary, lang: Lang, today: number, demo: boolean) {
  const r = sum.record, b = sum.b, loanId = sum.loan?.id ?? '—';
  if (lang === 'ur') return ['حساب: ادائیگی کا ریکارڈ' + (demo ? ' (فرضی ڈیمو)' : ''), b.ur + ' · قرض ' + loanId,
    'اب تک واجب اقساط: ' + r.due + ' · ادا شدہ: ' + r.paid + ' · وقت پر: ' + r.onTime,
    'مسلسل وقت پر: ' + r.streak + ' · کل واپس ادا: ' + fmtRs(r.repaid, 'ur'),
    fmtDate(today, 'ur', true) + ' کو ادارے کے بینک ریکارڈ سے جانچا گیا۔'].join('\n');
  return ['Hisaab repayment record' + (demo ? ' (synthetic demo)' : ''), b.name + ' · loan ' + loanId,
    'Installments due so far: ' + r.due + ' · paid: ' + r.paid + ' · on time: ' + r.onTime,
    'On time in a row: ' + r.streak + ' · total repaid: ' + fmtRs(r.repaid),
    'Checked against lender bank records on ' + fmtDate(today, 'en', true) + '.'].join('\n');
}

function Record({ c }: { c: Ctx }) {
  const { sum, lang } = c;
  const r = sum.record;
  const stat = (v: ReactNode, k: StrKey) => <div className="stat"><b className="num">{v}</b><span>{ts(lang, k)}</span></div>;
  const SQ = { ontime: 'on', late: 'late', overdue: 'open', today: 'future', upcoming: 'future' } as const;
  const LBL = { on: 'lgOn', late: 'lgLate', open: 'lgOpen', future: 'lgFuture' } as const;
  return (
    <>
      <section className="card">
        <h3>{ts(lang, 'recTitle')}</h3>
        <p className="muted">{ts(lang, 'recLead')}</p>
        <div className="stats">{stat(r.paid + ' / ' + r.due, 'recPaid')}{stat(r.onTime, 'recOnTime')}{stat(r.streak, 'recStreak')}{stat(r.months, 'recMonths')}</div>
        <div className="owe-row"><span>{ts(lang, 'recTotal')}</span><b><Money v={r.repaid} lang={lang} /></b></div>
      </section>
      <section className="card">
        <h3>{ts(lang, 'recGrid')}</h3>
        <div className="sq-grid">
          {sum.insts.map(i => {
            const cls = SQ[i.status];
            return <span key={i.id} className={'sq ' + cls} title={'#' + i.no + ' · ' + fmtDate(i.due, lang) + ' · ' + ts(lang, LBL[cls])}><span className="num">{i.no}</span></span>;
          })}
        </div>
        <div className="legend">
          <span><i className="on" />{ts(lang, 'lgOn')}</span><span><i className="late" />{ts(lang, 'lgLate')}</span>
          <span><i className="open" />{ts(lang, 'lgOpen')}</span><span><i className="future" />{ts(lang, 'lgFuture')}</span>
        </div>
        <p className="est-note">{ts(lang, 'recNote')}</p>
      </section>
      <section className="card">
        <CopySummary text={summaryText(sum, lang, c.S.today, c.S.kind === 'demo')} label={ts(lang, 'copy')} copied={ts(lang, 'copied')} fallback={ts(lang, 'copyFail')} />
      </section>
    </>
  );
}

function reportState(S: State, r: Exception, lang: Lang): [string, string, string] {
  const ch = chName(r.ch ?? 'JC', lang);
  if (r.status === 'resolved') {
    if (r.finding === 'already') return ['good', '✓', ts(lang, 'repAlready')];
    if (r.finding === 'failed') return ['crit', '✕', ts(lang, 'repFailed', { ch })];
    if (r.finding === 'pending') return ['neutral', '…', ts(lang, 'repPending')];
    const l = r.linked ? S.exById.get(r.linked) : undefined;
    if (l?.resolution?.action === 'refund') return ['warn', '↩', ts(lang, 'repRefund')];
    return ['good', '✓', ts(lang, 'repDone')];
  }
  if (r.finding === 'held') return ['warn', '?', ts(lang, 'repHeld')];
  if (r.finding === 'other') return ['warn', '?', ts(lang, 'repOther')];
  if (r.status === 'claimed') return ['info', '→', ts(lang, 'repClaimed', { ch })];
  return ['info', '…', ts(lang, 'repNotFound', { ch })];
}

function Help({ c }: { c: Ctx }) {
  const { S, sum, lang } = c;
  const ur = lang === 'ur';
  const reported = new Set(S.reports.map(r => r.tid).filter(Boolean));
  // Demo helper: offers the ID of a held payment that really belongs to this borrower (from the generator's labels).
  // Live books have no labels, so there is no example to offer.
  const ex = S.kind === 'demo' ? S.txnList.find(x => x.state === 'held' && x.truthBid === sum.b.id && !reported.has(x.tid)) : undefined;
  const strings: ReportStrings = {
    fCh: ts(lang, 'fCh'), fAmt: ts(lang, 'fAmt'), fDate: ts(lang, 'fDate'), fTid: ts(lang, 'fTid'), fTidHint: ts(lang, 'fTidHint'),
    fSend: ts(lang, 'fSend'), fExample: ts(lang, 'fExample'), eTid: ts(lang, 'eTid'), eAmt: ts(lang, 'eAmt'), sent: ts(lang, 'sent'),
    eOther: ur ? 'کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔' : 'Something went wrong. Please try again.', sending: ur ? 'بھیجا جا رہا ہے…' : 'Sending…',
  };
  const days = Array.from({ length: 14 }, (_, k) => S.today - k).map(d => ({ v: d, label: fmtDate(d, lang) + (d === S.today ? ' · ' + ts(lang, 'today') : '') }));
  return (
    <>
      <section className="card">
        <h3>{ts(lang, 'helpTitle')}</h3>
        <p className="muted">{ts(lang, 'helpLead')}</p>
        <ReportForm
          key={sum.b.id + lang}
          bid={sum.b.id}
          bookId={c.bookId}
          strings={strings}
          channels={(['JC', 'EP', 'RA', 'CA', 'BR'] as Ch[]).map(v => ({ v, label: chName(v, lang) }))}
          days={days}
          example={ex ? { ch: ex.ch, amt: String(ex.amount / 100), day: ex.day, tid: ex.tid } : null}
        />
      </section>
      {sum.reports.length > 0 && (
        <section className="card">
          <h3>{ts(lang, 'repTitle')}</h3>
          {sum.reports.map(r => {
            const [cls, icon, msg] = reportState(S, r, lang);
            return (
              <div key={r.id} className="report">
                <div className="row"><b><Money v={r.amount} lang={lang} /> · {chName(r.ch ?? 'JC', lang)}</b><Pill cls={cls} icon={icon}><span className="mono num">{r.reportedTid}</span></Pill></div>
                <span>{msg}</span>
              </div>
            );
          })}
        </section>
      )}
    </>
  );
}
