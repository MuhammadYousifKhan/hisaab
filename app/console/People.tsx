import Link from 'next/link';
import { AddBorrowerForm, AddStaffForm, IssueLoanForm, ResetPinForm } from '@/components/PeopleForms';
import { Pill } from '@/components/ui';
import { listStaff } from '@/lib/db/people';
import type { Loaded } from '@/lib/db/store';
import { CH, borrowerSummary, fmtDate, fmtRs, maskPhone } from '@/lib/engine';

type SP = Record<string, string | string[] | undefined>;

export default async function People({ L, sp }: { L: Loaded; sp: SP }) {
  const { S, book, conn } = L;
  const live = book.kind === 'live';
  const staff = await listStaff(conn);
  const focus = typeof sp.b === 'string' ? sp.b : '';
  const rows = S.borrowers.map(b => {
    const sum = borrowerSummary(S, b.id);
    const open = S.exceptions.filter(e => e.status !== 'resolved' && (e.bid === b.id || (e.tid && S.txns.get(e.tid)?.borrowerId === b.id))).length;
    const due = sum.record.due;
    return { b, sum, open, rate: due ? Math.round((sum.record.onTime / due) * 100) : null };
  });
  const noLoan = S.borrowers.filter(b => !S.loanByBid.has(b.id)).map(b => ({ id: b.id, name: b.name }));

  return (
    <>
      {sp.empty === '1' && <div className="done" role="status">No borrowers in this book yet. Add the first one below.</div>}
      {!live && (
        <div className="panel note-panel">
          <Pill cls="neutral" icon="i">Demo book</Pill> The demo book is generated from a seed, so its borrowers and loans are fixed.
          Switch to the <b>Live</b> book in the top bar to add borrowers, issue loans and take payments.
        </div>
      )}
      <section className="panel mt">
        <div className="row"><h3>Borrowers ({S.borrowers.length})</h3>{live && <a href="#add-borrower" className="btn sm ghost">Add borrower</a>}</div>
        {rows.length ? (
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>ID</th><th>Name</th><th>Phone</th><th>Pays by</th><th>Loan</th><th className="n">Still owed</th><th className="n">On time</th><th>Next due</th><th className="n">Open items</th><th /></tr></thead>
              <tbody>
                {rows.map(({ b, sum, open, rate }) => (
                  <tr key={b.id} className={focus === b.id ? 'open-row' : undefined}>
                    <td className="mono">{b.id}</td>
                    <td>{b.name}{b.work && <><br /><span className="muted">{b.work}{b.city ? ', ' + b.city : ''}</span></>}</td>
                    <td className="mono nw">{maskPhone(b.phone)}</td>
                    <td className="nw">{CH[b.ch].name}</td>
                    <td className="nw">{sum.loan ? <>{sum.loan.id} · {fmtRs(sum.loan.total)}<br /><span className="muted">{sum.loan.n} weeks from {fmtDate(sum.loan.start)}</span></> : <span className="muted">No loan</span>}</td>
                    <td className="n">{sum.loan ? fmtRs(sum.owed) : '—'}</td>
                    <td className="n">{rate === null ? '—' : rate + '%'}</td>
                    <td className="nw">{sum.overdue.length ? <Pill cls="crit" icon="!">{sum.overdue.length} overdue</Pill> : sum.next ? fmtDate(sum.next.due) : '—'}</td>
                    <td className="n">{open ? <Link href="/console?tab=queue">{open}</Link> : 0}</td>
                    <td className="nw"><Link href={'/borrower/' + b.id}>App view</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">No borrowers yet.</p>}
      </section>

      {live && (
        <div className="p-grid">
          <section className="panel" id="add-borrower">
            <h3>Add a borrower</h3>
            <p className="muted">Opens their account and sets the PIN they use to sign in to the borrower app. Their phone number is how wallet payments are matched to them.</p>
            <AddBorrowerForm bookId={book.id} />
          </section>
          <section className="panel" id="issue-loan">
            <h3>Issue a loan</h3>
            <p className="muted">One loan per borrower. The disbursement is posted to the journal the moment it is issued: loans receivable against loan capital and service charge income.</p>
            <IssueLoanForm bookId={book.id} borrowers={noLoan} today={S.today} />
          </section>
        </div>
      )}

      {live && S.borrowers.length > 0 && (
        <section className="panel mt">
          <h3>Forgotten PIN</h3>
          <p className="muted">Set a new PIN for a borrower. It also clears the 5-minute lock after too many wrong tries.</p>
          <div className="pin-list">
            {S.borrowers.map(b => <div key={b.id} className="pin-row"><span><b className="mono">{b.id}</b> {b.name}</span><ResetPinForm bookId={book.id} bid={b.id} /></div>)}
          </div>
        </section>
      )}

      <section className="panel mt">
        <h3>Staff accounts</h3>
        <p className="muted">Everyone who can sign in to this console. Every decision in the review queue is recorded under the name of the person who made it.</p>
        <ul className="plain">{staff.map(s => <li key={s.id}><b>{s.name}</b> <span className="muted mono">{s.username}</span></li>)}</ul>
        <AddStaffForm />
      </section>
    </>
  );
}
