import Link from 'next/link';
import { approveApp, declineApp } from '@/app/console/people-actions';
import { AddBorrowerForm, AddStaffForm, IssueLoanForm, ResetPinForm } from '@/components/PeopleForms';
import SubmitButton from '@/components/SubmitButton';
import { Pill } from '@/components/ui';
import { affordability, listApplications } from '@/lib/db/applications';
import { listStaff } from '@/lib/db/people';
import type { Loaded } from '@/lib/db/store';
import { CH, borrowerSummary, fmtDate, fmtRs, iso, maskPhone } from '@/lib/engine';

type SP = Record<string, string | string[] | undefined>;

export default async function People({ L, sp }: { L: Loaded; sp: SP }) {
  const { S, book, conn } = L;
  const staff = await listStaff(conn);
  const apps = await listApplications(conn, book.id, 'pending');
  const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v.slice(0, 300) : '');
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
      {sp.empty === '1' && <div className="done" role="status">No borrowers yet. Add the first one below.</div>}
      {one(sp.done) && <div className="done" role="status">{one(sp.done)}</div>}
      {one(sp.err) && <div className="done crit" role="alert">{one(sp.err)}</div>}
      <section className="panel" id="applications">
        <h3>Applications ({apps.length})</h3>
        {apps.length ? (
          <div className="app-list">
            {apps.map(a => {
              const rs = Number(a.amountPaisa) / 100;
              const af = affordability({ amountPaisa: Number(a.amountPaisa), weeks: a.weeks, incomePaisa: a.incomePaisa === null ? null : Number(a.incomePaisa) });
              const years = a.workYears === null ? null : a.workYears >= 3 ? 'over 3 years' : a.workYears >= 1 ? '1 to 3 years' : 'under a year';
              return (
                <div key={a.id} className="app-item">
                  <div className="row">
                    <b>{a.name}</b>
                    <span className="mono">{maskPhone(a.phone)}</span>
                    <span>{a.work}, {a.city}</span>
                    <span>{fmtRs(Number(a.amountPaisa))} over {a.weeks} weeks</span>
                    <span className="muted">pays by {CH[a.channel as keyof typeof CH]?.name ?? a.channel} · applied {a.createdAt.toISOString().slice(0, 10)}</span>
                  </div>
                  <div className="afford">
                    {a.incomePaisa !== null ? <span>Earns about <b>{fmtRs(Number(a.incomePaisa))}</b> a month</span> : <span className="muted">No income given</span>}
                    {years && <span>{years} in this work</span>}
                    {a.refName && <span>Reference: {a.refName}{a.refPhone ? ' · ' + maskPhone(a.refPhone) : ''}</span>}
                    {af && <Pill cls={af.level} icon={af.level === 'good' ? '✓' : '!'}>{'Installment ' + fmtRs(af.installment) + ' a week = ' + Math.round(af.share * 100) + '% of weekly income'}</Pill>}
                    {af && af.level !== 'good' && af.maxPrincipal > 0 && <span>Up to about {fmtRs(af.maxPrincipal)} keeps it to a quarter</span>}
                    {af && <span className="muted small">Guide only: from what the applicant declared, not verified.</span>}
                  </div>
                  <form action={approveApp} className="inline-form">
                    <input type="hidden" name="bookId" value={book.id} />
                    <input type="hidden" name="appId" value={a.id} />
                    <label className="small">Principal <input name="principal" inputMode="numeric" defaultValue={rs} size={7} /></label>
                    <label className="small">Charge <input name="fee" inputMode="numeric" defaultValue={Math.round(rs * 0.2 / 100) * 100} size={6} /></label>
                    <label className="small">Weeks <input name="n" inputMode="numeric" defaultValue={a.weeks} size={3} /></label>
                    <label className="small">First due <input name="firstDue" type="date" defaultValue={iso(S.today + 7)} min={iso(S.today + 1)} max={iso(S.today + 60)} /></label>
                    <SubmitButton>Approve</SubmitButton>
                  </form>
                  <form action={declineApp} className="inline-form">
                    <input type="hidden" name="bookId" value={book.id} />
                    <input type="hidden" name="appId" value={a.id} />
                    <SubmitButton ghost>Decline</SubmitButton>
                  </form>
                </div>
              );
            })}
          </div>
        ) : <p className="muted">No applications waiting. Applicants apply at <Link href="/apply">/apply</Link>.</p>}
      </section>
      <section className="panel mt">
        <div className="row"><h3>Borrowers ({S.borrowers.length})</h3><a href="#add-borrower" className="btn sm ghost">Add borrower</a></div>
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

      <div className="p-grid">
        <section className="panel" id="add-borrower">
          <h3>Add a borrower</h3>
          <AddBorrowerForm bookId={book.id} />
        </section>
        <section className="panel" id="issue-loan">
          <h3>Issue a loan</h3>
          <IssueLoanForm bookId={book.id} borrowers={noLoan} today={S.today} />
        </section>
      </div>

      {S.borrowers.length > 0 && (
        <section className="panel mt">
          <h3>Reset a PIN</h3>
          <div className="pin-list">
            {S.borrowers.map(b => <div key={b.id} className="pin-row"><span><b className="mono">{b.id}</b> {b.name}</span><ResetPinForm bookId={book.id} bid={b.id} /></div>)}
          </div>
        </section>
      )}

      <section className="panel mt">
        <h3>Staff</h3>
        <ul className="plain">{staff.map(s => <li key={s.id}><b>{s.name}</b> <span className="muted mono">{s.username}</span></li>)}</ul>
        <AddStaffForm />
      </section>
    </>
  );
}
