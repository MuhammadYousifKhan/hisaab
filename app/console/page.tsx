import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { opsDecision } from '@/app/actions';
import CollectionsChart from '@/components/CollectionsChart';
import SubmitButton from '@/components/SubmitButton';
import { Facts, Pill, Rs } from '@/components/ui';
import { loadView, requireOps } from '@/lib/auth/viewer';
import Intake from './Intake';
import People from './People';
import {
  ACCTS, CH, KIND_LABEL, REASON_LABEL, appliedInfo, bankByDay, dayName, entryById, explain, fmtDate, fmtRs, forecastDaily, forecastTotal,
  hhmm, iso, kpis, maskPhone, txState,
} from '@/lib/engine';
import type { Batch, Ch, Exception, State, Txn } from '@/lib/engine';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Lender console' };

type Tab = 'queue' | 'pay' | 'set' | 'jrn' | 'people' | 'intake';
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const RULE: Record<string, string> = { R1: 'Loan reference', R2: 'Registered phone', R3: 'Account name', 'Ops review': 'Ops review' };

export default async function ConsolePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const tab: Tab = (['queue', 'pay', 'set', 'jrn', 'people', 'intake'] as const).find(x => x === sp.tab) ?? 'queue';
  const session = await requireOps('/console' + (sp.tab ? '?tab=' + one(sp.tab) : ''));
  const L = await loadView(session);
  const { S } = L;
  const bookId = L.book.id;
  const TODAY = S.today;
  const K = kpis(S), fc = forecastTotal(S, 14);
  const autoPct = K.successN ? Math.round((K.autoN / K.successN) * 100) : 100;
  const openN = S.exceptions.filter(e => e.status !== 'resolved').length;
  const bank = bankByDay(S);
  const past = Array.from({ length: 30 }, (_, k) => TODAY - 29 + k).map(day => ({ day, v: bank.get(day) || 0 }));
  const daily = forecastDaily(S, 14);
  const link = (o: Record<string, string>) => '/console?' + new URLSearchParams({ tab, ...o }).toString();

  const done = one(sp.done), err = one(sp.err);
  let banner: ReactNode = null;
  if (done) {
    const e = /^JE-/.test(done) ? entryById(S, done) : undefined;
    banner = e
      ? <div className="done" role="status"><Pill cls="good" icon="✓">Posted {e.id}</Pill><span>{REASON_LABEL[e.reason] || e.reason}: {explain(e, 'en')}</span></div>
      : <div className="done" role="status"><Pill cls="good" icon="✓">Recorded</Pill><span>{done === 'claim' ? 'Claim raised. The item stays open until the money arrives.' : 'Marked as done.'}</span></div>;
  } else if (err) {
    banner = <div className="done crit" role="alert">{err === 'borrower' ? 'Choose a borrower before applying the payment.' : err === 'stale' ? 'That item was already resolved. The queue below is up to date.' : 'That request was not valid, so nothing was written.'}</div>;
  }

  return (
    <>
      {banner}
      <div className="kpis">
        <Kpi label="Collected in bank" tag="Actual" val={<Rs v={K.bank} />} sub={'after ' + fmtRs(K.fees) + ' channel fees'} />
        <Kpi label="On the way from channels" tag="Actual" val={<Rs v={K.transit} />} sub={K.overdueTransit ? <Pill cls="crit" icon="!">{fmtRs(K.overdueTransit)} overdue</Pill> : 'normally settles next morning'} />
        <Kpi label="Pending at banks" tag="Memo" val={<Rs v={K.pending} />} sub={K.pendingN + ' transfer' + (K.pendingN === 1 ? '' : 's') + ', not counted yet'} />
        <Kpi label="Needs review" val={String(K.open)} sub={fmtRs(K.suspense) + ' held in suspense' + (K.claimed ? ' · ' + K.claimed + ' waiting on channels' : '')} />
        <Kpi label="Matched automatically" val={autoPct + '%'} sub={K.autoN + ' of ' + K.successN + ' channel payments'} />
      </div>
      <div className="c-grid">
        <section className="panel">
          <div className="row">
            <h3>Money reaching the bank, per day</h3>
            <div className="legend"><span><i className="bar" />Settled in bank (actual)</span><span><i className="projk" />Expected payments (projection)</span></div>
          </div>
          <CollectionsChart past={past} fc={daily} today={TODAY} />
          <details>
            <summary>Show as a table</summary>
            <div className="tbl-wrap">
              <table>
                <thead><tr><th>Day</th><th className="n">Amount</th><th>Kind</th></tr></thead>
                <tbody>
                  {past.map(p => <tr key={'a' + p.day}><td className="nw">{dayName(p.day)} {fmtDate(p.day)}</td><td className="n">{fmtRs(p.v)}</td><td>Actual</td></tr>)}
                  {daily.map(f => <tr key={'p' + f.day}><td className="nw">{dayName(f.day)} {fmtDate(f.day)}</td><td className="n">{fmtRs(f.low)} – {fmtRs(f.high)}</td><td>Projection</td></tr>)}
                </tbody>
              </table>
            </div>
          </details>
        </section>
        <section className="panel fc">
          <span className="est-tag"><span aria-hidden="true">≈</span> Projection · not guaranteed</span>
          <h3>Expected payments, {fmtDate(fc.from)} to {fmtDate(fc.to)}</h3>
          <p className="fc-range"><Rs v={fc.low} /> – <Rs v={fc.high} /></p>
          <p className="muted">Most likely around <Rs v={fc.mid} /></p>
          <p className="fc-method">Never added to the actual totals.</p>
        </section>
      </div>
      <nav className="ctabs" aria-label="Console sections">
        {([['queue', 'Review queue', openN], ['pay', 'Payments', null], ['set', 'Settlements', null], ['jrn', 'Journal', null], ['people', 'Borrowers & loans', null], ['intake', 'Intake', null]] as const).map(([k, l, c]) => (
          <Link key={k} href={'/console?tab=' + k} aria-current={tab === k ? 'page' : undefined} scroll={false}>
            {l}{c !== null && <span className={'count' + (c ? '' : ' zero')}>{c}</span>}
          </Link>
        ))}
      </nav>
      {tab === 'queue' && <Queue S={S} bookId={bookId} />}
      {tab === 'pay' && <Payments S={S} sp={sp} link={link} />}
      {tab === 'set' && <Settlements S={S} />}
      {tab === 'jrn' && <Journal S={S} sp={sp} link={link} />}
      {tab === 'people' && <People L={L} sp={sp} />}
      {tab === 'intake' && <Intake L={L} sp={sp} />}
    </>
  );
}

function Kpi({ label, tag, val, sub }: { label: string; tag?: string; val: ReactNode; sub: ReactNode }) {
  return (
    <div className="kpi">
      <div className="lbl">{label}{tag && <span className="pill neutral">{tag}</span>}</div>
      <div className="val">{val}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

/* ---------------- Review queue ---------------- */
function Queue({ S, bookId }: { S: State; bookId: number }) {
  const prio = (e: Exception) => (e.kind === 'borrower_report' ? 0 : e.kind === 'missing_deposit' ? 1 : 2);
  const open = S.exceptions.filter(e => e.status !== 'resolved').sort((a, b) => prio(a) - prio(b) || b.day - a.day);
  const done = S.exceptions.filter(e => e.status === 'resolved').slice().reverse();
  return (
    <>
      <div className="exq">
        {open.length ? open.map(ex => <ExCard key={ex.id} S={S} ex={ex} bookId={bookId} />) : <div className="panel"><Pill cls="good" icon="✓">Nothing waiting</Pill></div>}
      </div>
      {done.length > 0 && (
        <details className="more">
          <summary>Resolved ({done.length})</summary>
          <div className="resolved-list">
            {done.map(e => (
              <div key={e.id}>
                <Pill cls="good" icon="✓">{KIND_LABEL[e.kind]}</Pill>
                <span className="mono">{e.id}</span>
                <span>{e.resolution?.note}</span>
                {e.resolution?.je && <span className="mono">{e.resolution.je}</span>}
                <span className="muted">{e.resolution?.by}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

function Mono({ v }: { v: string }) { return <span className="mono">{v}</span>; }
const bName = (S: State, id?: string | null) => (id && S.bById.has(id) ? S.bById.get(id)!.name : '—');
const chn = (ch?: Ch) => (ch ? CH[ch].name : '');

function Decide({ type, exId, label, ghost, bid, bookId }: { type: string; exId: string; label: string; ghost?: boolean; bid?: string; bookId: number }) {
  return (
    <form action={opsDecision} style={{ display: 'contents' }}>
      <input type="hidden" name="bookId" value={bookId} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="exId" value={exId} />
      {bid && <input type="hidden" name="bid" value={bid} />}
      <SubmitButton ghost={ghost}>{label}</SubmitButton>
    </form>
  );
}
function ApplyTo({ S, ex, def, bookId }: { S: State; ex: Exception; def?: string | null; bookId: number }) {
  return (
    <form action={opsDecision} className="actions" style={{ display: 'flex' }}>
      <input type="hidden" name="bookId" value={bookId} />
      <input type="hidden" name="type" value="apply" />
      <input type="hidden" name="exId" value={ex.id} />
      <select name="bid" defaultValue={def || ''} aria-label={'Borrower for ' + ex.id} required>
        {!def && <option value="">Choose borrower…</option>}
        {S.borrowers.map(b => <option key={b.id} value={b.id}>{b.name} · {b.loanId ?? b.id + ', no loan'}</option>)}
      </select>
      <SubmitButton>Apply to borrower</SubmitButton>
    </form>
  );
}

function ExCard({ S, ex, bookId }: { S: State; ex: Exception; bookId: number }) {
  const TODAY = S.today;
  const tx = ex.tid ? S.txns.get(ex.tid) : undefined;
  const b = ex.batch ? S.batches.get(ex.batch) : undefined;
  const ch = chn(ex.ch);
  const linkedReports = S.reports.filter(r => r.linked === ex.id && r.status !== 'resolved');
  let title: ReactNode = null, why: ReactNode = null, suggest: ReactNode = null, actions: ReactNode = null;
  let facts: [string, ReactNode][] = [];

  if (ex.kind === 'orphan_payment' && tx) {
    const def = linkedReports[0]?.bid ?? ex.suggest?.bid ?? null;
    title = <><Rs v={ex.amount} /> by {ch} from an unknown sender</>;
    why = <>Sent from {maskPhone(tx.phone)}{tx.name ? ' (' + tx.name + ')' : ''} with reference “{tx.ref || 'none'}”. No borrower has this number, name or loan reference, so it is held in suspense rather than guessed.</>;
    facts = [['Payment', <Mono key="t" v={tx.tid} />], ['Received', fmtDate(tx.day) + ', ' + hhmm(tx.min)]];
    if (linkedReports.length) suggest = <><b>{bName(S, linkedReports[0].bid)}</b> reported this exact transaction ID from the borrower app.</>;
    else if (ex.suggest) suggest = <><b>{bName(S, ex.suggest.bid)}</b>: {ex.suggest.why}. Not applied automatically, because a name in a note is not proof.</>;
    actions = <><ApplyTo bookId={bookId} S={S} ex={ex} def={def} /><Decide bookId={bookId} type="refund" exId={ex.id} label="Refund to sender" ghost /></>;
  } else if (ex.kind === 'reference_conflict' && tx && ex.refBid) {
    title = <><Rs v={ex.amount} /> with reference “{tx.ref}”, which is someone else’s loan</>;
    why = <>The reference points to {bName(S, ex.refBid)} ({S.loanByBid.get(ex.refBid)?.id}), but {ex.suggest?.why}. Applying it to the wrong loan would hide a missed payment, so it is held.</>;
    facts = [['Payment', <><Mono v={tx.tid} /> · {ch}</>], ['Received', fmtDate(tx.day) + ', ' + hhmm(tx.min)]];
    suggest = <>Apply to <b>{bName(S, ex.suggest?.bid)}</b>, the account holder.</>;
    actions = <ApplyTo bookId={bookId} S={S} ex={ex} def={ex.suggest?.bid} />;
  } else if (ex.kind === 'possible_duplicate' && tx && ex.dupOf) {
    const first = S.txns.get(ex.dupOf)!;
    title = <>{bName(S, ex.bid)} paid <Rs v={ex.amount} /> twice, {Math.abs(tx.min - first.min)} minutes apart</>;
    why = <>{tx.tid} has the same borrower, amount and channel as {first.tid}, which was applied. This one is held until we know whether the borrower meant to pay ahead.</>;
    facts = [['First', <><Mono v={first.tid} /> · {hhmm(first.min)}</>], ['Second', <><Mono v={tx.tid} /> · {hhmm(tx.min)}</>]];
    suggest = <>Most double payments within minutes are app retries. Refund unless the borrower asks to keep it.</>;
    actions = <><Decide bookId={bookId} type="refund" exId={ex.id} label="Mark for refund" /><Decide bookId={bookId} type="apply" exId={ex.id} label="Keep as extra payment" ghost bid={ex.bid ?? undefined} /></>;
  } else if (ex.kind === 'reversal' && tx) {
    title = <>{ch} reversed {bName(S, ex.bid)}’s <Rs v={ex.amount} /> payment</>;
    why = <>Reason from the channel: “{ex.reason}”. A mirror entry was posted automatically and installment {(ex.nos || []).map(n => '#' + n).join(', ')} is open again. The borrower should hear it from us before they see it.</>;
    facts = [['Payment', <><Mono v={tx.tid} /> · paid {fmtDate(tx.day)}</>], ['Reversed', fmtDate(tx.reversed?.day ?? ex.day)]];
    actions = <Decide bookId={bookId} type="ack" exId={ex.id} label="Mark borrower notified" />;
  } else if (ex.kind === 'unexpected_deposit' && tx) {
    const def = linkedReports[0]?.bid ?? null;
    title = <><Rs v={ex.amount} /> reached the bank with no payment record</>;
    why = <>Bank narration: “{tx.ref}”. No channel reported this money, so the data alone can’t say whose it is.</>;
    facts = [['Bank line', <Mono key="l" v={tx.tid} />], ['Value date', fmtDate(tx.day)]];
    if (linkedReports.length) suggest = <><b>{bName(S, def)}</b> reported this deposit from the borrower app.</>;
    actions = <><ApplyTo bookId={bookId} S={S} ex={ex} def={def} /><Decide bookId={bookId} type="refund" exId={ex.id} label="Return to depositor" ghost /></>;
  } else if (ex.kind === 'missing_deposit' && b) {
    title = <>{ch} has not settled {fmtDate(b.day)} ({b.txns.length} payment{b.txns.length === 1 ? '' : 's'})</>;
    why = <>Expected <Rs v={b.expectedNet ?? 0} /> on {fmtDate(b.day + 1)}. Nothing has arrived after {TODAY - b.day - 1} days. The payments still count for the borrowers; the money sits in clearing, marked overdue.</>;
    facts = [['Payments', <>{b.txns.map(id => { const x = S.txns.get(id)!; return <div key={id}><Mono v={id} /> {bName(S, x.borrowerId)} {fmtRs(x.amount)}</div>; })}</>]];
    actions = ex.status === 'claimed' ? <span className="muted">Claim raised {fmtDate(ex.claim!.day)}. Stays open until the money arrives.</span> : <Decide bookId={bookId} type="claim" exId={ex.id} label={'Raise claim with ' + ch} />;
  } else if ((ex.kind === 'settlement_short' || ex.kind === 'settlement_over') && b) {
    const short = ex.kind === 'settlement_short';
    title = <>{ch} settlement for {fmtDate(b.day)} arrived <Rs v={ex.amount} /> {short ? 'short' : 'over'}</>;
    why = <>{b.txns.length} payments totalling <Rs v={b.gross} />, minus a {(CH[b.ch].bps / 100).toFixed(1)}% fee of <Rs v={b.fee ?? 0} />{b.clawback ? <>, minus <Rs v={b.clawback} /> reversed</> : null} = <Rs v={b.expectedNet ?? 0} /> expected. The bank received <Rs v={b.received ?? 0} />.</>;
    facts = [['Bank line', <><Mono v={b.lineId ?? ''} /> · {fmtDate(b.settleDay ?? b.day)}</>]];
    actions = short
      ? <>{ex.status === 'claimed' ? <span className="muted">Claim raised {fmtDate(ex.claim!.day)}.</span> : <Decide bookId={bookId} type="claim" exId={ex.id} label={'Raise claim with ' + ch} ghost />}<Decide bookId={bookId} type="accept_fee" exId={ex.id} label="Accept as extra fee" /></>
      : <Decide bookId={bookId} type="ack" exId={ex.id} label="Mark as checked" />;
  } else if (ex.kind === 'borrower_report') {
    title = <>{bName(S, ex.bid)} says <Rs v={ex.amount} /> by {ch} on {fmtDate(ex.payDay ?? TODAY)} is missing</>;
    facts = [['Reported ID', <Mono key="r" v={ex.reportedTid ?? ''} />]];
    const l = ex.linked ? S.exById.get(ex.linked) : undefined;
    const lt = ex.tid ? S.txns.get(ex.tid) : undefined;
    if (ex.finding === 'held' && l && lt) {
      why = <>Found it: {ex.tid} is held as “{KIND_LABEL[l.kind].toLowerCase()}” ({l.id}). Applying it resolves both items.</>;
      facts.push(['Found', <><Rs v={lt.amount} /> · {fmtDate(lt.day)}{lt.amount !== ex.amount ? ' · amount differs from report' : ''}</>]);
      actions = <Decide bookId={bookId} type="apply" exId={l.id} label={'Apply ' + ex.tid + ' to ' + bName(S, ex.bid)} bid={ex.bid ?? undefined} />;
    } else if (ex.finding === 'other' && lt) {
      why = <>{ex.tid} is already applied to {bName(S, lt.borrowerId)}. Check with both borrowers before anything moves.</>;
      actions = <Decide bookId={bookId} type="ack" exId={ex.id} label="Mark as checked" />;
    } else if (ex.tid) {
      why = <>Found {ex.tid}, but its state is “{String(ex.finding).replace('_', ' ')}”. Explain this to the borrower before closing.</>;
      actions = <Decide bookId={bookId} type="ack" exId={ex.id} label="Mark borrower informed" />;
    } else {
      why = <>No payment with this ID in any channel file yet.</>;
      actions = ex.status === 'claimed' ? <span className="muted">Trace requested {fmtDate(ex.claim!.day)}.</span> : <Decide bookId={bookId} type="claim" exId={ex.id} label={'Ask ' + ch + ' to trace'} />;
    }
  }
  const hi = ex.kind === 'borrower_report' || ex.kind === 'missing_deposit';
  return (
    <article className={'exc' + (hi ? ' hi' : '')}>
      <div className="exc-head">
        <Pill cls={hi ? 'crit' : 'warn'} icon={ex.kind === 'borrower_report' ? '☎' : hi ? '!' : '?'}>{KIND_LABEL[ex.kind]}</Pill>
        {ex.status === 'claimed' && <Pill cls="info" icon="→">Claim raised</Pill>}
        <span className="mono muted">{ex.id}</span>
        <span className="muted">{fmtDate(ex.day)}</span>
        <h4>{title}</h4>
      </div>
      <p className="why">{why}</p>
      {facts.length > 0 && <Facts items={facts} />}
      {suggest && <div className="suggest"><Pill cls="info" icon="★">Suggestion</Pill><span>{suggest}</span></div>}
      <div className="actions">{actions}</div>
    </article>
  );
}

/* ---------------- Payments ---------------- */
function Payments({ S, sp, link }: { S: State; sp: SP; link: (o: Record<string, string>) => string }) {
  const fch = one(sp.ch) || 'all', fst = one(sp.st) || 'all', open = one(sp.open);
  const n = Math.min(Math.max(Number(one(sp.n)) || 40, 40), 1000);
  let rows = S.txnList.slice().sort((a, b) => b.day - a.day || b.min - a.min);
  if (fch !== 'all') rows = rows.filter(x => x.ch === fch);
  if (fst !== 'all') rows = rows.filter(x => txState(x).key === fst);
  const shown = rows.slice(0, n);
  const keep = { ch: fch, st: fst, n: String(n) };
  return (
    <>
      <form className="filters" action="/console" method="get">
        <input type="hidden" name="tab" value="pay" />
        <div className="field"><label htmlFor="f-fch">Channel</label>
          <select id="f-fch" name="ch" defaultValue={fch}>
            <option value="all">All channels</option>
            {(['EP', 'JC', 'CA', 'RA', 'BR'] as Ch[]).map(c => <option key={c} value={c}>{CH[c].name}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="f-fst">State</label>
          <select id="f-fst" name="st" defaultValue={fst}>
            {[['all', 'All states'], ['settled', 'Settled'], ['transit', 'In transit'], ['held', 'Held'], ['failed', 'Failed'], ['pending', 'Pending'], ['reversed', 'Reversed'], ['refund_due', 'Refund due']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <button type="submit" className="btn sm ghost">Filter</button>
        <p className="muted" style={{ paddingBottom: 10 }}>{rows.length} payments</p>
      </form>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>When</th><th>Payment ID</th><th>Channel</th><th>Payer</th><th className="n">Amount</th><th>Matched to</th><th>Rule</th><th>Bank</th><th>State</th></tr></thead>
          <tbody>
            {shown.map(x => {
              const s = txState(x), ai = appliedInfo(S, x), isOpen = open === x.tid;
              return [
                <tr key={x.tid} className={isOpen ? 'open-row' : undefined}>
                  <td className="nw">{fmtDate(x.day)} <span className="muted">{hhmm(x.min)}</span></td>
                  <td><Link className="trace-link" href={link({ ...keep, open: isOpen ? '' : x.tid })} scroll={false} aria-expanded={isOpen}>{x.tid} {isOpen ? '▾' : '▸'}</Link></td>
                  <td className="nw">{CH[x.ch].name}</td>
                  <td>{x.name}{x.phone && <><br /><span className="muted mono">{maskPhone(x.phone)}</span></>}{!x.name && !x.phone && <span className="muted">{x.ref}</span>}</td>
                  <td className="n">{fmtRs(x.amount)}</td>
                  <td>{x.borrowerId ? <>{bName(S, x.borrowerId)}{ai?.nos.length ? <span className="muted"> {ai.nos.map(k => '#' + k).join(' ')}</span> : null}</> : <span className="muted">—</span>}</td>
                  <td className="nw">{RULE[x.rule ?? ''] || '—'}</td>
                  <td className="nw">{x.settled ? 'Settled ' + fmtDate(x.settleDay ?? x.day) : x.batchLate ? <b style={{ color: 'var(--crit)' }}>Overdue</b> : x.state === 'failed' || x.state === 'pending' ? <span className="muted">—</span> : 'Due ' + fmtDate(x.day + 1)}</td>
                  <td><Pill cls={s.cls} icon={s.icon}>{s.label}</Pill></td>
                </tr>,
                isOpen ? <tr key={x.tid + '-t'} className="trace"><td colSpan={9}><Trace S={S} x={x} /></td></tr> : null,
              ];
            })}
          </tbody>
        </table>
      </div>
      {rows.length > shown.length && <div className="more"><Link className="btn ghost sm" href={link({ ...keep, n: String(n + 40) })} scroll={false}>Show more ({rows.length - shown.length} left)</Link></div>}
    </>
  );
}

function Trace({ S, x }: { S: State; x: Txn }) {
  const raws = S.raw.filter(r => r.tid === x.tid);
  const batch: Batch | undefined = x.batchId ? S.batches.get(x.batchId) : undefined;
  const line = x.ch === 'BR' ? S.bankById.get(x.tid) : batch?.lineId ? S.bankById.get(batch.lineId) : undefined;
  const jes = S.ledger.entries.filter(e => e.src.includes(x.tid) || (batch && e.src[0] === batch.id));
  return (
    <div className="trace-grid">
      <div>
        <h4>1 · As received</h4>
        {raws.length ? raws.map(r => (
          <div key={r.id}>
            <p className="muted mono">{r.id} · {r.src}{S.ignored.includes(r) ? ' · repeat delivery, ignored by the dedupe gate' : ''}</p>
            <pre className="raw">{JSON.stringify(r.payload, null, 2)}</pre>
          </div>
        )) : <p className="muted">Arrived only as a bank statement line, shown on the right.</p>}
      </div>
      <div>
        <h4>2 · Journal entries</h4>
        <div className="je-list">
          {jes.length ? jes.map(e => <div key={e.id}><b className="mono">{e.id}</b> · {REASON_LABEL[e.reason] || e.reason}<br />{explain(e, 'en')}</div>)
            : <div className="muted">No entries: {x.state === 'failed' ? 'the payment failed, so no money moved.' : 'still pending at the bank.'}</div>}
        </div>
      </div>
      <div>
        <h4>3 · Bank statement</h4>
        {line ? <>
          <pre className="raw">{JSON.stringify({ id: line.id, value_date: iso(line.day), amount: (line.amount / 100).toFixed(2), narration: line.narration, ref: line.ref }, null, 2)}</pre>
          {batch && batch.txns.length > 1 && <p className="muted">One line for {batch.txns.length} payments in batch {batch.id}.</p>}
        </> : <p className="muted">Not in the bank yet{x.batchLate ? ': the settlement is overdue.' : '.'}</p>}
      </div>
    </div>
  );
}

/* ---------------- Settlements ---------------- */
function Settlements({ S }: { S: State }) {
  const list = Array.from(S.batches.values()).filter(b => b.ch !== 'RA').sort((a, b) => b.day - a.day || a.ch.localeCompare(b.ch));
  return (
    <>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Batch</th><th>Channel</th><th className="n">Payments</th><th className="n">Gross</th><th className="n">Fee</th><th className="n">Reversed</th><th className="n">Expected</th><th className="n">Received</th><th className="n">Gap</th><th>Status</th></tr></thead>
          <tbody>
            {list.map(b => {
              const fee = b.fee ?? Math.round((b.gross * CH[b.ch].bps) / 10000);
              const exp = b.expectedNet ?? b.gross - fee - b.clawback;
              const status = b.settled && !b.diff ? <Pill cls="good" icon="✓">Settled {fmtDate(b.settleDay ?? b.day)}</Pill>
                : b.settled && (b.diff ?? 0) > 0 ? <Pill cls="warn" icon="!">Short</Pill>
                : b.settled ? <Pill cls="warn" icon="!">Over</Pill>
                : b.late ? <Pill cls="crit" icon="!">Missing</Pill>
                : <Pill cls="info" icon="→">Due {fmtDate(b.day + 1)}</Pill>;
              return (
                <tr key={b.id}>
                  <td className="mono nw">{b.id}</td><td className="nw">{CH[b.ch].name}</td><td className="n">{b.txns.length}</td>
                  <td className="n">{fmtRs(b.gross)}</td><td className="n">{fmtRs(fee)}</td><td className="n">{b.clawback ? fmtRs(b.clawback) : '—'}</td>
                  <td className="n">{fmtRs(exp)}</td><td className="n">{b.settled ? fmtRs(b.received ?? 0) : '—'}</td>
                  <td className="n">{b.settled && b.diff ? fmtRs(-b.diff) : '—'}</td><td>{status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------------- Journal ---------------- */
function Journal({ S, sp, link }: { S: State; sp: SP; link: (o: Record<string, string>) => string }) {
  const ROUTINE = new Set(['LOAN_DISBURSED', 'PAYMENT_APPLIED', 'SETTLEMENT']);
  const jf = one(sp.jf) || 'all', open = one(sp.je);
  const n = Math.min(Math.max(Number(one(sp.n)) || 30, 30), 2000);
  let list = S.ledger.entries.slice().reverse();
  if (jf === 'adj') list = list.filter(e => !ROUTINE.has(e.reason));
  if (jf === 'ops') list = list.filter(e => e.actor.startsWith('ops'));
  const shown = list.slice(0, n);
  const keep = { jf, n: String(n) };
  return (
    <>
      <form className="filters" action="/console" method="get">
        <input type="hidden" name="tab" value="jrn" />
        <div className="field"><label htmlFor="f-jf">Show</label>
          <select id="f-jf" name="jf" defaultValue={jf}>
            <option value="all">All entries</option><option value="adj">Adjustments only</option><option value="ops">Posted by ops</option>
          </select>
        </div>
        <button type="submit" className="btn sm ghost">Filter</button>
        <p className="muted" style={{ paddingBottom: 10 }}>{list.length} entries</p>
      </form>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Entry</th><th>Date</th><th>Type</th><th>Explanation</th><th className="n">Amount</th><th>Posted by</th></tr></thead>
          <tbody>
            {shown.map(e => {
              const isOpen = open === e.id;
              return [
                <tr key={e.id} className={isOpen ? 'open-row' : undefined}>
                  <td><Link className="trace-link" href={link({ ...keep, je: isOpen ? '' : e.id })} scroll={false} aria-expanded={isOpen}>{e.id} {isOpen ? '▾' : '▸'}</Link></td>
                  <td className="nw">{fmtDate(e.day)}</td><td className="nw">{REASON_LABEL[e.reason] || e.reason}</td>
                  <td style={{ minWidth: 280 }}>{explain(e, 'en')}</td><td className="n">{fmtRs(e.total)}</td><td className="nw muted">{e.actor}</td>
                </tr>,
                isOpen ? (
                  <tr key={e.id + '-l'} className="trace">
                    <td colSpan={6}>
                      <div className="tbl-wrap">
                        <table>
                          <thead><tr><th>Account</th><th>Borrower</th><th className="n">Debit</th><th className="n">Credit</th></tr></thead>
                          <tbody>{e.lines.map((l, i) => <tr key={i}><td><span className="mono">{l.acct}</span> {ACCTS[l.acct].name}</td><td>{l.sub ? bName(S, l.sub) : <span className="muted">—</span>}</td><td className="n">{l.dr ? fmtRs(l.dr) : ''}</td><td className="n">{l.cr ? fmtRs(l.cr) : ''}</td></tr>)}</tbody>
                        </table>
                      </div>
                      <p className="muted" style={{ marginTop: 8 }}>Sources: <span className="mono">{e.src.join(' · ')}</span>{e.reverses && <> · reverses <span className="mono">{e.reverses}</span></>}{e.reversedBy && <> · reversed by <span className="mono">{e.reversedBy}</span></>}</p>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
      {list.length > shown.length && <div className="more"><Link className="btn ghost sm" href={link({ ...keep, n: String(n + 40) })} scroll={false}>Show more ({list.length - shown.length} left)</Link></div>}
    </>
  );
}
