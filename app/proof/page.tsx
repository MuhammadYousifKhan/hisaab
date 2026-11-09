import type { Metadata } from 'next';
import { newBook } from '@/app/actions';
import ProofButtons from '@/components/ProofButtons';
import SubmitButton from '@/components/SubmitButton';
import { Audience, Pill } from '@/components/ui';
import { getSession, loadView } from '@/lib/auth/viewer';
import { dbChecks } from '@/lib/db/store';
import { fmtRs, runChecks, trialBalance } from '@/lib/engine';
import { STATE_SVG } from '@/lib/content/stateSvg';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Proof' };

function Check({ c }: { c: { title: string; detail: string; pass: boolean; value: string } }) {
  return (
    <div className="check">
      <Pill cls={c.pass ? 'good' : 'crit'} icon={c.pass ? '✓' : '✕'}>{c.pass ? 'Pass' : 'Fail'}</Pill>
      <div><b>{c.title}</b><p>{c.detail}</p></div>
      <span className="v">{c.value}</span>
    </div>
  );
}

export default async function ProofPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  const L = await loadView(session);
  const { S, book, conn, actionCount } = L;
  const live = book.kind === 'live';
  const staff = session?.role === 'ops';
  const engine = runChecks(S);
  const db = await dbChecks(L);
  const all = [...engine, ...db];
  const pass = all.filter(c => c.pass).length;
  const sc = S.score;
  const tb = trialBalance(S);
  const dr = tb.reduce((s, a) => s + Math.max(0, a.bal), 0), cr = tb.reduce((s, a) => s + Math.max(0, -a.bal), 0);
  return (
    <>
      <Audience kind="proof" />
      {sp.fresh && <div className="done" role="status"><Pill cls="good" icon="✓">New book</Pill><span>{sp.fresh === 'live' ? 'An empty live book is open. Older books are kept.' : 'Scenario ' + String(sp.fresh) + ' generated with an empty review history.'}</span></div>}
      {sp.err === 'confirm' && <div className="done crit" role="alert">Type NEW to confirm starting a fresh live book.</div>}
      {sp.err === 'seed' && <div className="done crit" role="alert">Use a whole number between 1 and 2147483647 for the seed.</div>}
      <section className="panel proof-head">
        <div>
          <p className="eyebrow">Success criteria, checked live</p>
          <h2>{pass} of {all.length} checks pass</h2>
          <p className="muted">Recomputed on every visit from the stored {live ? 'borrowers, loans, ' : ''}channel files, bank lines and {actionCount} recorded decision{actionCount === 1 ? '' : 's'}.</p>
          <p className="db-note">Book #{book.id} · {live ? 'live book' : 'demo book, seed ' + book.seed} · {conn.kind === 'pglite' ? 'embedded Postgres (PGlite)' : 'Postgres via DATABASE_URL'}</p>
        </div>
        <ProofButtons />
      </section>
      <h3 className="mt" style={{ marginBottom: 8 }}>In the engine</h3>
      <div className="checks" style={{ marginTop: 0 }}>{engine.map(c => <Check key={c.title} c={c} />)}</div>
      <h3 className="mt" style={{ marginBottom: 8 }}>In Postgres</h3>
      <div className="checks" style={{ marginTop: 0 }}>{db.map(c => <Check key={c.title} c={c} />)}</div>

      <div className="p-grid">
        <section className="panel">
          {live ? (
            <>
              <h3>Planted problems</h3>
              <p className="muted">The live book holds real inputs, so there are no planted problems to score against. The checks above are the evidence here: every entry balances, the stored journal equals a fresh replay, and no input is dropped. Switch to the Demo book in the top bar to see the planted-vs-caught scorecard.</p>
              <p>{sc.raised} review items raised so far; {sc.auto} payments matched automatically.</p>
            </>
          ) : (
            <>
              <h3>Planted problems vs what the system did</h3>
              <p className="muted">The generator labels every anomaly it plants. This compares those labels with what the matcher did on its own, before anyone touched the review queue.</p>
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th>Planted problem</th><th className="n">Planted</th><th className="n">Handled</th><th>Expected handling</th></tr></thead>
                  <tbody>
                    {sc.rows.map(r => (
                      <tr key={r.kind}>
                        <td>{r.label}</td><td className="n">{r.injected}</td>
                        <td className="n"><Pill cls={r.caught === r.injected ? 'good' : 'crit'} icon={r.caught === r.injected ? '✓' : '!'}>{r.caught}</Pill></td>
                        <td className="muted">{r.how}</td>
                      </tr>
                    ))}
                    <tr><td><b>Total</b></td><td className="n"><b>{sc.injected}</b></td><td className="n"><b>{sc.caught}</b></td><td /></tr>
                  </tbody>
                </table>
              </div>
              <p>{sc.tp} of {sc.raised} review items match a planted problem ({sc.fp} false alarm{sc.fp === 1 ? '' : 's'}). Of {sc.auto} payments matched automatically, {sc.correct} went to the right borrower.</p>
            </>
          )}
        </section>
        <section className="panel">
          <h3>Books</h3>
          <p className="muted">{live ? 'The live book follows the real calendar and takes data entered in the app.' : 'Same seed, same data. A new demo book generates a different two months of payments, with new random problems on top of the scripted ones.'} Old books stay in the database untouched.</p>
          <p className="muted">{S.raw.length} channel events · {S.bank.length} bank lines · {S.txnList.length} payments · {S.ledger.entries.length} journal entries{live ? ' · ' + S.borrowers.length + ' borrowers · ' + S.loans.length + ' loans' : ''}</p>
          {staff ? (
            <>
              <form action={newBook} className="seedrow">
                <div className="field"><label htmlFor="seed-in">Demo seed</label><input id="seed-in" name="seed" inputMode="numeric" defaultValue={live ? 2026 : book.seed} /></div>
                <SubmitButton small={false}>New demo book</SubmitButton>
              </form>
              <form action={newBook}><input type="hidden" name="seed" value="random" /><SubmitButton small={false} ghost>New demo book, random seed</SubmitButton></form>
              <form action={newBook} className="seedrow">
                <input type="hidden" name="kind" value="live" />
                <div className="field"><label htmlFor="live-confirm">Fresh live book (type NEW)</label><input id="live-confirm" name="confirm" autoComplete="off" placeholder="NEW" /></div>
                <SubmitButton small={false} ghost>Start empty live book</SubmitButton>
              </form>
            </>
          ) : <p className="muted">Staff can start a new book after signing in.</p>}
        </section>
      </div>

      <section className="panel mt">
        <h3>Payment states and what each one writes</h3>
        <div dangerouslySetInnerHTML={{ __html: STATE_SVG }} />
      </section>
      <section className="panel mt">
        <h3>Trial balance</h3>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Account</th><th>Type</th><th className="n">Debit</th><th className="n">Credit</th></tr></thead>
            <tbody>
              {tb.map(a => <tr key={a.code}><td><span className="mono">{a.code}</span> {a.name}</td><td className="muted">{a.type}</td><td className="n">{a.bal > 0 ? fmtRs(a.bal) : ''}</td><td className="n">{a.bal < 0 ? fmtRs(-a.bal) : ''}</td></tr>)}
              <tr><td><b>Total</b></td><td /><td className="n"><b>{fmtRs(dr)}</b></td><td className="n"><b>{fmtRs(cr)}</b></td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
