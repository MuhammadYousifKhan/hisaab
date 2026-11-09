import type { Metadata } from 'next';
import ProofButtons from '@/components/ProofButtons';
import { Pill } from '@/components/ui';
import { loadView } from '@/lib/auth/viewer';
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

export default async function ProofPage() {
  const L = await loadView();
  const { S } = L;
  const engine = runChecks(S);
  const db = await dbChecks(L);
  const all = [...engine, ...db];
  const pass = all.filter(c => c.pass).length;
  const tb = trialBalance(S);
  const dr = tb.reduce((s, a) => s + Math.max(0, a.bal), 0), cr = tb.reduce((s, a) => s + Math.max(0, -a.bal), 0);
  return (
    <>
      <section className="panel proof-head">
        <div>
          <h2>{pass} of {all.length} checks pass</h2>
          <p className="muted">Recomputed on every visit from everything stored.</p>
        </div>
        <ProofButtons />
      </section>
      <h3 className="mt" style={{ marginBottom: 8 }}>Ledger</h3>
      <div className="checks" style={{ marginTop: 0 }}>{engine.map(c => <Check key={c.title} c={c} />)}</div>
      <h3 className="mt" style={{ marginBottom: 8 }}>Database</h3>
      <div className="checks" style={{ marginTop: 0 }}>{db.map(c => <Check key={c.title} c={c} />)}</div>

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
