import { headers } from 'next/headers';
import Link from 'next/link';
import { AgentUpload, BankUpload } from '@/components/IntakeForms';
import { Pill } from '@/components/ui';
import { recentInputs, type Loaded } from '@/lib/db/store';
import { CH, fmtRs, iso } from '@/lib/engine';
import { ingestToken } from '@/lib/ingest/ingest';
import { paymentPayload } from '@/lib/ingest/payloads';

type SP = Record<string, string | string[] | undefined>;

export default async function Intake({ L }: { L: Loaded; sp: SP }) {
  const { S, book, conn } = L;
  const h = await headers();
  const base = (h.get('x-forwarded-proto') ?? 'http') + '://' + (h.get('host') ?? 'localhost:3000');
  const token = ingestToken();
  const log = await recentInputs(conn, book.id, 50);
  const quarantined = new Map(S.quarantined.map(q => [q.re.id, q.error]));
  const someone = S.borrowers.find(b => S.loanByBid.has(b.id));
  const d = S.today;
  const agentSample = 'receipt_no,agent_id,customer_ref,customer_name,amount,status,collected_at\nCA481516,AG-114,' + (someone?.loanId ?? 'L001') + ',' + (someone?.name.toUpperCase() ?? 'ALI RAZA') + ',2000,COLLECTED,' + iso(d) + ' 11:05';
  const bankSample = 'date,time,amount,narration,ref,bank_ref\n' + iso(d) + ',09:12,1975.00,EASYPAISA SETTLEMENT ' + iso(d - 1) + ',EP-SETL-' + iso(d - 1) + ',STMT-000123';
  const jc = paymentPayload({ ch: 'JC', tid: 'JC' + (10000000 + (d * 7919) % 89999999), amount: 300000, phone: someone?.phone ?? '03451110202', name: (someone?.name ?? 'Shazia Parveen').toUpperCase(), ref: someone?.loanId ?? '', status: 'success', day: d, min: 600 });
  const curl = 'curl -X POST ' + base + '/api/channels/jazzcash \\\n  -H "Authorization: Bearer ' + (token ?? '<INGEST_TOKEN>') + '" \\\n  -H "Content-Type: application/json" \\\n  -d \'' + JSON.stringify(jc) + '\'';

  return (
    <>
      <div className="p-grid mt">
        <section className="panel">
          <h3>Agent collections</h3>
          <p className="muted small">Columns: <span className="mono">receipt_no, agent_id, customer_ref, customer_name, amount, status, collected_at</span></p>
          <AgentUpload sample={agentSample} />
        </section>
        <section className="panel">
          <h3>Bank statement</h3>
          <p className="muted small">Columns: <span className="mono">date, time, amount, narration, ref, bank_ref</span></p>
          <BankUpload sample={bankSample} />
        </section>
      </div>

      <section className="panel mt">
        <h3>Webhooks</h3>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Channel</th><th>Address</th></tr></thead>
            <tbody>
              {(['easypaisa', 'jazzcash', 'raast', 'agent'] as const).map(s => (
                <tr key={s}><td className="nw">{CH[({ easypaisa: 'EP', jazzcash: 'JC', raast: 'RA', agent: 'CA' } as const)[s]].name}</td><td className="mono">POST {base}/api/channels/{s}</td></tr>
              ))}
              <tr><td className="nw">Bank statement</td><td className="mono">POST {base}/api/bank/statement</td></tr>
            </tbody>
          </table>
        </div>
        <p>Ingest token: {token ? <span className="mono">{token}</span> : <b>not set. Set INGEST_TOKEN to turn the webhooks on.</b>}</p>
        <details>
          <summary>Example request</summary>
          <pre className="raw">{curl}</pre>
        </details>
      </section>

      <section className="panel mt">
        <h3>Latest</h3>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th className="n">#</th><th>Input</th><th>Source</th><th>Reference</th><th className="n">Amount</th><th>Result</th></tr></thead>
            <tbody>
              {log.map(x => {
                const q = x.kind === 'raw' ? quarantined.get(x.id) : undefined;
                const t = x.kind === 'raw' ? S.txns.get(x.label) : S.txns.get(x.id);
                const amount = x.kind === 'bank' ? x.amount : t?.amount ?? null;
                const result = x.redelivery ? <Pill cls="neutral" icon="=">Repeat, ignored</Pill>
                  : q ? <Pill cls="crit" icon="✕">Quarantined</Pill>
                  : x.kind === 'bank' ? (S.txns.has(x.id) ? <Pill cls="warn" icon="?">No record, held</Pill> : <Pill cls="good" icon="✓">Settlement matched</Pill>)
                  : t ? <Pill cls={t.state === 'applied' ? 'good' : t.state === 'held' ? 'warn' : t.state === 'failed' || t.state === 'reversed' ? 'crit' : 'neutral'} icon="•">{t.state === 'applied' ? 'Applied' : t.state === 'held' ? 'Held for review' : String(t.state).replace('_', ' ')}</Pill>
                  : <Pill cls="neutral" icon="↺">Reversal</Pill>;
                return (
                  <tr key={x.kind + x.id}>
                    <td className="n mono">{x.ord || '—'}</td>
                    <td className="mono nw">{x.id}</td>
                    <td className="nw">{x.src}</td>
                    <td className="mono">{t && x.kind === 'raw' ? <Link href={'/console?tab=pay&open=' + encodeURIComponent(t.tid)}>{x.label}</Link> : x.label}</td>
                    <td className="n">{amount !== null ? fmtRs(amount) : '—'}</td>
                    <td>{result}{q && <><br /><span className="muted small">{q}</span></>}</td>
                  </tr>
                );
              })}
              {!log.length && <tr><td colSpan={6} className="muted">Nothing received yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
