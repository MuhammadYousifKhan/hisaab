'use client';
import { useActionState } from 'react';
import { simAdvance, simBroken, simClaimPaid, simDeposit, simRepeat, simReverse, simSandbox, simSend, simSettle, type SandboxState, type SimState } from '@/app/simulate/actions';

type Act = (s: SimState, fd: FormData) => Promise<SimState>;

function Out({ s, pending }: { s: SimState; pending: boolean }) {
  if (pending) return null;
  return (
    <>
      {s.error && <p className="err" role="alert">{s.error}</p>}
      {s.ok && <p className="msg good" role="status">{s.ok}</p>}
      {s.payload && <details open><summary>What the channel sent</summary><pre className="raw">{s.payload}</pre></details>}
    </>
  );
}

function useSim(a: Act) { return useActionState<SimState, FormData>(a, {}); }

export function SendForm({ borrowers }: { borrowers: { id: string; name: string; phone: string }[] }) {
  const [s, action, pending] = useSim(simSend);
  return (
    <form action={action} className="form grid2">
      <div className="field"><label htmlFor="sm-ch">Channel</label>
        <select id="sm-ch" name="ch" defaultValue="JC"><option value="JC">JazzCash</option><option value="EP">Easypaisa</option><option value="RA">Raast transfer</option><option value="CA">Cash agent</option></select></div>
      <div className="field"><label htmlFor="sm-b">Paid by</label>
        <select id="sm-b" name="bid" defaultValue={borrowers[0]?.id ?? 'unknown'}>
          {borrowers.map(b => <option key={b.id} value={b.id}>{b.name} ({b.id})</option>)}
          <option value="unknown">An unknown sender</option>
        </select></div>
      <div className="field"><label htmlFor="sm-amt">Amount (Rs)</label><input id="sm-amt" name="amount" inputMode="decimal" defaultValue="2000" required /></div>
      <div className="field"><label htmlFor="sm-st">Outcome</label>
        <select id="sm-st" name="status" defaultValue="success"><option value="success">Succeeded</option><option value="failed">Failed</option><option value="pending">Still pending</option></select></div>
      <div className="field"><label htmlFor="sm-ph">Sender’s phone (wallets)</label><input id="sm-ph" name="phone" inputMode="tel" dir="ltr" placeholder="blank = their own" />
        </div>
      <div className="field"><label htmlFor="sm-nm">Sender’s name</label><input id="sm-nm" name="name" placeholder="blank = their own" /></div>
      <div className="field"><label htmlFor="sm-ref">Reference / note</label><input id="sm-ref" name="ref" placeholder="e.g. L002" /></div>
      <div className="field"><label htmlFor="sm-ago">Sent minutes ago</label><input id="sm-ago" name="minsAgo" inputMode="numeric" defaultValue="0" /></div>
      <div className="span2"><Out s={s} pending={pending} /><button type="submit" className="btn" disabled={pending}>{pending ? 'Sending…' : 'Send payment'}</button></div>
    </form>
  );
}

export function ReverseForm({ payments }: { payments: { tid: string; label: string }[] }) {
  const [s, action, pending] = useSim(simReverse);
  if (!payments.length) return <p className="muted">No payments to reverse yet.</p>;
  return (
    <form action={action} className="form">
      <div className="field"><label htmlFor="sr-t">Payment</label>
        <select id="sr-t" name="tid" defaultValue={payments[0].tid}>{payments.map(p => <option key={p.tid} value={p.tid}>{p.label}</option>)}</select></div>
      <div className="field"><label htmlFor="sr-r">Reason from the channel</label><input id="sr-r" name="reason" defaultValue="Disputed by account holder" /></div>
      <Out s={s} pending={pending} />
      <button type="submit" className="btn ghost" disabled={pending}>{pending ? 'Sending…' : 'Reverse payment'}</button>
    </form>
  );
}

export function SettleForm({ batch, expected }: { batch: string; expected: string }) {
  const [s, action, pending] = useSim(simSettle);
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="batch" value={batch} />
      <input name="short" inputMode="decimal" defaultValue="0" aria-label={'Shortfall in rupees for ' + batch} dir="ltr" size={5} />
      <button type="submit" className="btn sm" disabled={pending}>{pending ? 'Paying…' : 'Pay out ' + expected}</button>
      <Out s={s} pending={pending} />
    </form>
  );
}

export function AdvanceForm() {
  const [s, action, pending] = useSim(simAdvance);
  return (
    <form action={action} className="inline-form">
      <select name="days" defaultValue="1" aria-label="Days to move forward"><option value="1">1 day</option><option value="2">2 days</option><option value="7">7 days</option></select>
      <button type="submit" className="btn ghost" disabled={pending}>{pending ? 'Moving…' : 'Move the clock forward'}</button>
      <Out s={s} pending={pending} />
    </form>
  );
}

export function SandboxForm() {
  const [s, action, pending] = useActionState<SandboxState, FormData>(simSandbox, {});
  const r = s.result;
  return (
    <form action={action} className="form">
      <button type="submit" className="btn" disabled={pending}>{pending ? 'Running…' : 'Run sandbox scenario'}</button>
      {!pending && s.error && <p className="err" role="alert">{s.error}</p>}
      {!pending && r && (
        <>
          <p className={'msg ' + (r.steps.every(x => x.ok) ? 'good' : 'crit')} role="status">
            {r.steps.filter(x => x.ok).length} of {r.steps.length} states produced and handled correctly (sandbox {r.tag}).
          </p>
          <ul className="sbx-list">
            {r.steps.map(x => <li key={x.label}><span className={'pill ' + (x.ok ? 'good' : 'crit')}>{x.ok ? '✓' : '✕'}</span><span>{x.label}</span><span className="mono muted small">{x.detail}</span></li>)}
          </ul>
          <p className="small">Sandbox borrowers (PIN {'1234'}): {r.borrowers.map(b => b.id + ' ' + b.phone).join(' · ')}</p>
          <p className="small"><a href="/console?tab=queue">Open the review queue</a> · <a href="/proof">Open Proof</a></p>
        </>
      )}
    </form>
  );
}

export function RepeatForm({ options }: { options: { id: string; label: string }[] }) {
  const [s, action, pending] = useSim(simRepeat);
  if (!options.length) return <p className="muted small">No payments to repeat yet.</p>;
  return (
    <form action={action} className="inline-form">
      <select name="raw" aria-label="Payment to deliver again" defaultValue={options[0].id}>{options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
      <button type="submit" className="btn sm ghost" disabled={pending}>Deliver again</button>
      <Out s={s} pending={pending} />
    </form>
  );
}

export function BrokenForm() {
  const [s, action, pending] = useSim(simBroken);
  return (
    <form action={action} className="inline-form">
      <select name="ch" aria-label="Channel" defaultValue="JC"><option value="JC">JazzCash</option><option value="EP">Easypaisa</option><option value="RA">Raast</option><option value="CA">Cash agent</option></select>
      <button type="submit" className="btn sm ghost" disabled={pending}>Send malformed payload</button>
      <Out s={s} pending={pending} />
    </form>
  );
}

export function DepositForm() {
  const [s, action, pending] = useSim(simDeposit);
  return (
    <form action={action} className="inline-form">
      <input name="amount" inputMode="decimal" defaultValue="1500" aria-label="Amount in rupees" size={6} dir="ltr" />
      <input name="narration" defaultValue="CASH DEPOSIT BR-0412 SUKKUR" aria-label="Bank narration" />
      <button type="submit" className="btn sm ghost" disabled={pending}>Deposit with no record</button>
      <Out s={s} pending={pending} />
    </form>
  );
}

/** A channel pays back a shortfall it was claimed for, quoting the batch (bank reference CLAIM-<batch>). */
export function ClaimPaidForm({ claims }: { claims: { batch: string; label: string; left: number }[] }) {
  const [s, action, pending] = useSim(simClaimPaid);
  if (!claims.length) return <p className="muted small">No open shortfall claims. Settle a batch with a shortfall first.</p>;
  return (
    <form action={action} className="inline-form">
      <select name="batch" aria-label="Claim being paid back" defaultValue={claims[0].batch}>{claims.map(c => <option key={c.batch} value={c.batch}>{c.label}</option>)}</select>
      <input name="amount" inputMode="decimal" defaultValue={String(claims[0].left / 100)} aria-label="Amount paid back, in rupees" size={6} dir="ltr" />
      <button type="submit" className="btn sm ghost" disabled={pending}>Channel pays back</button>
      <Out s={s} pending={pending} />
    </form>
  );
}
