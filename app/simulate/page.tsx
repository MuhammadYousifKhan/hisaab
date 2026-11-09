import type { Metadata } from 'next';
import Link from 'next/link';
import { AdvanceForm, ReverseForm, SendForm, SettleForm } from '@/components/SimForms';
import { Pill } from '@/components/ui';
import { requireOps } from '@/lib/auth/viewer';
import { clockFor, loadState } from '@/lib/db/store';
import { CH, dayName, fmtDate, fmtRs } from '@/lib/engine';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Channel simulator' };

export default async function SimulatePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ok = typeof sp.ok === 'string' ? sp.ok.slice(0, 200) : '';
  await requireOps('/simulate');
  const L = await loadState({ kind: 'live' });
  const { S, book } = L;
  const withLoan = S.borrowers.filter(b => S.loanByBid.has(b.id)).map(b => ({ id: b.id, name: b.name, phone: b.phone }));
  const reversible = S.txnList.filter(t => t.ch !== 'BR' && (t.state === 'applied' || t.state === 'held')).slice().reverse().slice(0, 40)
    .map(t => ({ tid: t.tid, label: t.tid + ' · ' + CH[t.ch].name + ' · ' + fmtRs(t.amount) + ' · ' + fmtDate(t.day) }));
  const open = Array.from(S.batches.values()).filter(b => !b.settled && b.ch !== 'RA' && b.gross - b.clawback > 0).sort((a, b) => a.day - b.day);
  const today = clockFor(book).day;

  return (
    <>
      {ok && <div className="done" role="status"><Pill cls="good" icon="✓">Done</Pill><span>{ok}</span></div>}
      <div className="aud">
        <span className="aud-k">Test tooling</span>
        <p><b>This page stands in for the real world.</b> Until Easypaisa, JazzCash, Raast and the bank are connected, it sends the same payloads they would, through the same intake as the webhooks. Everything goes to the <b>live book</b> and is stored, matched and journalled like real data.</p>
      </div>
      <div className="kpis">
        <div className="kpi"><div className="lbl">Live book date</div><div className="val">{dayName(today)} {fmtDate(today)}</div><div className="sub">{book.clockOffset ? 'Simulated: ' + book.clockOffset + ' day' + (book.clockOffset === 1 ? '' : 's') + ' ahead of the real date' : 'Real date, Pakistan time'}</div></div>
        <div className="kpi"><div className="lbl">Borrowers with a loan</div><div className="val">{withLoan.length}</div><div className="sub">{withLoan.length ? 'Ready to send payments' : <Link href="/console?tab=people">Add a borrower and issue a loan first</Link>}</div></div>
        <div className="kpi"><div className="lbl">Unsettled batches</div><div className="val">{open.length}</div><div className="sub">waiting for a bank deposit</div></div>
        <div className="kpi"><div className="lbl">Open review items</div><div className="val">{S.exceptions.filter(e => e.status === 'open').length}</div><div className="sub"><Link href="/console?tab=queue">Open the review queue</Link></div></div>
      </div>

      <div className="p-grid mt">
        <section className="panel">
          <h3>1 · A payment arrives</h3>
          <p className="muted">Pick who paid and how. Leave the phone blank for a normal payment, or type another number to see a payment that can’t be matched.</p>
          <SendForm borrowers={withLoan} />
        </section>
        <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <section className="panel">
            <h3>3 · A channel reverses a payment</h3>
            <ReverseForm payments={reversible} />
          </section>
          <section className="panel">
            <h3>4 · Time passes</h3>
            <p className="muted">Moves the live book’s date forward so installments fall due and late settlements are flagged. It can’t go back.</p>
            <AdvanceForm />
          </section>
        </div>
      </div>

      <section className="panel mt">
        <h3>2 · The bank receives the day’s settlement</h3>
        <p className="muted">Wallets and the agent network pay out each day’s payments as one deposit, minus their fee. Enter a shortfall in rupees to see a short settlement; leave 0 for the exact amount. Raast transfers reach the bank by themselves.</p>
        {open.length ? (
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Batch</th><th>Channel</th><th className="n">Payments</th><th className="n">Gross</th><th className="n">Expected</th><th>Status</th><th>Shortfall (Rs) and payout</th></tr></thead>
              <tbody>
                {open.map(b => {
                  const fee = Math.round((b.gross * CH[b.ch].bps) / 10000), exp = b.gross - fee - b.clawback;
                  return (
                    <tr key={b.id}>
                      <td className="mono nw">{b.id}</td><td className="nw">{CH[b.ch].name}</td><td className="n">{b.txns.length}</td>
                      <td className="n">{fmtRs(b.gross)}</td><td className="n">{fmtRs(exp)}</td>
                      <td>{b.late ? <Pill cls="crit" icon="!">Overdue</Pill> : <Pill cls="info" icon="→">Due {fmtDate(b.day + 1)}</Pill>}</td>
                      <td><SettleForm batch={b.id} expected={fmtRs(exp)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">No batch is waiting. Send a JazzCash, Easypaisa or agent payment first.</p>}
      </section>
    </>
  );
}
