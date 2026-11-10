import type { Metadata } from 'next';
import Link from 'next/link';
import ProofButtons from '@/components/ProofButtons';
import { Pill } from '@/components/ui';
import { getSession, loadView } from '@/lib/auth/viewer';
import { dbChecks } from '@/lib/db/store';
import { fmtRs, runChecks, stateCoverage, traceChecks, trialBalance } from '@/lib/engine';
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

export default async function ProofPage() {
  const session = await getSession();
  const L = await loadView(session);
  const { S } = L;
  const staff = session?.role === 'ops';
  const ledger = runChecks(S);
  const trace = traceChecks(S);
  const db = await dbChecks(L);
  const states = stateCoverage(S);
  const all = [...ledger, ...trace, ...db];
  const pass = all.filter(c => c.pass).length;
  const seen = states.filter(r => r.count > 0);
  const mishandled = states.filter(r => r.bad > 0);
  const tb = trialBalance(S);
  const dr = tb.reduce((s, a) => s + Math.max(0, a.bal), 0), cr = tb.reduce((s, a) => s + Math.max(0, -a.bal), 0);
  return (
    <>
      <section className="panel proof-head">
        <div>
          <h2>{pass} of {all.length} checks pass</h2>
          <p className="muted">
            {seen.length} of {states.length} exceptional payment states seen in this book, {mishandled.length ? <b className="err">{mishandled.length} mishandled</b> : 'every one handled as designed'}.
            Recomputed on every visit from everything stored.
          </p>
          {S.ledger.entries.length === 0 && <p className="err">Nothing has been recorded yet, so these checks have nothing to test. Staff can load sandbox transactions from the Simulator.</p>}
        </div>
        <ProofButtons />
      </section>

      <h3 className="mt" style={{ marginBottom: 8 }}>Ledger consistency</h3>
      <div className="checks" style={{ marginTop: 0 }}>{ledger.map(c => <Check key={c.title} c={c} />)}</div>
      <h3 className="mt" style={{ marginBottom: 8 }}>Traceability</h3>
      <div className="checks" style={{ marginTop: 0 }}>{trace.map(c => <Check key={c.title} c={c} />)}</div>
      <h3 className="mt" style={{ marginBottom: 8 }}>Database</h3>
      <div className="checks" style={{ marginTop: 0 }}>{db.map(c => <Check key={c.title} c={c} />)}</div>

      <section className="panel mt">
        <h3>Exceptional payment states</h3>
        <p className="muted small" style={{ marginBottom: 10 }}>Each state is checked against the ledger: what should have been posted was, and nothing else.</p>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>State</th><th>What Hisaab does</th><th className="n">In this book</th><th>Handled</th>{staff && <th>Example</th>}</tr></thead>
            <tbody>
              {states.map(r => (
                <tr key={r.key}>
                  <td className="nw"><b>{r.label}</b></td>
                  <td style={{ minWidth: 260 }}>{r.handling}</td>
                  <td className="n">{r.count}</td>
                  <td className="nw">{!r.count ? <Pill cls="neutral" icon="·">Not seen yet</Pill> : r.bad ? <Pill cls="crit" icon="✕">{r.bad} wrong</Pill> : <Pill cls="good" icon="✓">As designed</Pill>}</td>
                  {staff && <td className="nw mono">{r.tid ? <Link href={'/console?tab=pay&open=' + encodeURIComponent(r.tid)}>{r.tid}</Link> : r.example ?? ''}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel mt">
        <h3>Payment states</h3>
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
