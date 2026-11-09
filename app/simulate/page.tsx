import type { Metadata } from 'next';
import Link from 'next/link';
import { AdvanceForm, BrokenForm, DepositForm, RepeatForm, ReverseForm, SandboxForm, SendForm, SettleForm } from '@/components/SimForms';
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
  const L = await loadState();
  const { S, book } = L;
  const withLoan = S.borrowers.filter(b => S.loanByBid.has(b.id)).map(b => ({ id: b.id, name: b.name, phone: b.phone }));
  const reversible = S.txnList.filter(t => t.ch !== 'BR' && (t.state === 'applied' || t.state === 'held')).slice().reverse().slice(0, 40)
    .map(t => ({ tid: t.tid, label: t.tid + ' · ' + CH[t.ch].name + ' · ' + fmtRs(t.amount) + ' · ' + fmtDate(t.day) }));
  const open = Array.from(S.batches.values()).filter(b => !b.settled && b.ch !== 'RA' && b.gross - b.clawback > 0).sort((a, b) => a.day - b.day);
  const today = clockFor(book).day;
  const repeatable = S.raw.filter(r => !r.redelivery && r.payload.event !== 'payment.reversed').slice().reverse().slice(0, 20)
    .map(r => ({ id: r.id, label: r.tid + ' · ' + CH[r.ch].name }));

  return (
    <>
      {ok && <div className="done" role="status"><Pill cls="good" icon="✓">Done</Pill><span>{ok}</span></div>}
      <div className="kpis">
        <div className="kpi"><div className="lbl">Date</div><div className="val">{dayName(today)} {fmtDate(today)}</div><div className="sub">{book.clockOffset ? 'Simulated, ' + book.clockOffset + ' day' + (book.clockOffset === 1 ? '' : 's') + ' ahead' : 'Today'}</div></div>
        <div className="kpi"><div className="lbl">Borrowers with a loan</div><div className="val">{withLoan.length}</div><div className="sub">{withLoan.length ? '' : <Link href="/console?tab=people">Add a borrower and issue a loan first</Link>}</div></div>
        <div className="kpi"><div className="lbl">Unsettled batches</div><div className="val">{open.length}</div><div className="sub" /></div>
        <div className="kpi"><div className="lbl">Open review items</div><div className="val">{S.exceptions.filter(e => e.status === 'open').length}</div><div className="sub"><Link href="/console?tab=queue">Open the queue</Link></div></div>
      </div>

      <section className="panel mt">
        <h3>Sandbox scenario</h3>
        <p className="muted">Adds four sandbox borrowers and one of every payment situation to this book, then checks each one.</p>
        <SandboxForm />
      </section>

      <div className="p-grid mt">
        <section className="panel">
          <h3>Send a payment</h3>
          <SendForm borrowers={withLoan} />
        </section>
        <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <section className="panel">
            <h3>Reverse a payment</h3>
            <ReverseForm payments={reversible} />
          </section>
          <section className="panel">
            <h3>Other events</h3>
            <div className="form">
              <RepeatForm options={repeatable} />
              <BrokenForm />
              <DepositForm />
            </div>
          </section>
          <section className="panel">
            <h3>Move the date forward</h3>
            <AdvanceForm />
          </section>
        </div>
      </div>

      <section className="panel mt">
        <h3>Settle a batch</h3>
        {open.length ? (
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Batch</th><th>Channel</th><th className="n">Payments</th><th className="n">Gross</th><th className="n">Expected</th><th>Status</th><th>Shortfall (Rs)</th></tr></thead>
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
        ) : <p className="muted">No batch is waiting.</p>}
      </section>
    </>
  );
}
