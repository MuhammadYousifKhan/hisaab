'use client';
import { useActionState, useState, type ReactNode } from 'react';
import { addBorrower, addStaffMember, issueLoan, resetPin, type FormState } from '@/app/console/people-actions';
import { dayFromIso, fmtDate, fmtRs, iso } from '@/lib/engine/util';

function Result({ state, pending }: { state: FormState; pending: boolean }) {
  if (pending) return null;
  return (
    <>
      {state.error && <p className="err" role="alert">{state.error}</p>}
      {state.ok && (
        <div className="msg good" role="status">
          {state.ok}
          {state.pin && <p className="pin-once">Sign-in PIN: <b className="mono">{state.pin}</b>. Give it to the borrower now; it is not shown again.</p>}
        </div>
      )}
    </>
  );
}

function F({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return <div className="field"><label htmlFor={id}>{label}</label>{children}{hint && <span className="hint">{hint}</span>}</div>;
}

export function AddBorrowerForm({ bookId }: { bookId: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addBorrower, {});
  return (
    <form action={action} className="form grid2" key={state.ok ?? 'f'}>
      <input type="hidden" name="bookId" value={bookId} />
      <F id="nb-name" label="Full name"><input id="nb-name" name="name" autoComplete="off" required /></F>
      <F id="nb-ur" label="Name in Urdu (optional)"><input id="nb-ur" name="nameUr" lang="ur" dir="rtl" autoComplete="off" /></F>
      <F id="nb-phone" label="Mobile number" hint="Payments from this number match automatically."><input id="nb-phone" name="phone" inputMode="tel" dir="ltr" placeholder="0300 1234567" required /></F>
      <F id="nb-ch" label="Usually pays by">
        <select id="nb-ch" name="ch" defaultValue="JC">
          <option value="JC">JazzCash</option><option value="EP">Easypaisa</option><option value="CA">Cash agent</option><option value="RA">Raast transfer</option>
        </select>
      </F>
      <F id="nb-work" label="Work"><input id="nb-work" name="work" placeholder="Home-based tailor" /></F>
      <F id="nb-workur" label="Work in Urdu (optional)"><input id="nb-workur" name="workUr" lang="ur" dir="rtl" /></F>
      <F id="nb-city" label="City"><input id="nb-city" name="city" placeholder="Sukkur" /></F>
      <F id="nb-pin" label="Sign-in PIN (optional)" hint="4 to 6 digits. Leave blank to generate one."><input id="nb-pin" name="pin" inputMode="numeric" maxLength={6} dir="ltr" autoComplete="off" /></F>
      <div className="span2"><Result state={state} pending={pending} /><button type="submit" className="btn" disabled={pending}>{pending ? 'Adding…' : 'Add borrower'}</button></div>
    </form>
  );
}

export function IssueLoanForm({ bookId, borrowers, today }: { bookId: number; borrowers: { id: string; name: string }[]; today: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(issueLoan, {});
  const [principal, setPrincipal] = useState('30000');
  const [fee, setFee] = useState('6000');
  const [n, setN] = useState('12');
  const [first, setFirst] = useState(iso(today + 7));
  const P = Number(principal), Fe = Number(fee), N = Number(n), d = dayFromIso(first);
  const ok = Number.isInteger(P) && P >= 1000 && Number.isInteger(Fe) && Fe >= 0 && Number.isInteger(N) && N >= 4 && N <= 52 && d !== null;
  const total = (P + Fe) * 100, inst = ok ? Math.floor(total / N / 100) * 100 : 0, last = ok ? total - inst * (N - 1) : 0;
  // Once the last borrower without a loan gets one, keep showing the confirmation instead of swapping it for this note.
  if (!borrowers.length) return state.ok ? <Result state={state} pending={pending} /> : <p className="muted">Everyone in this book already has a loan. Add a borrower first.</p>;
  return (
    <form action={action} className="form grid2" key={state.ok ?? 'f'}>
      <input type="hidden" name="bookId" value={bookId} />
      <F id="nl-b" label="Borrower">
        <select id="nl-b" name="bid" required defaultValue="">
          <option value="" disabled>Choose…</option>
          {borrowers.map(b => <option key={b.id} value={b.id}>{b.id} · {b.name}</option>)}
        </select>
      </F>
      <F id="nl-first" label="First installment due" hint="Weekly after that."><input id="nl-first" name="firstDue" type="date" min={iso(today + 1)} max={iso(today + 60)} value={first} onChange={e => setFirst(e.target.value)} required /></F>
      <F id="nl-p" label="Principal (Rs)"><input id="nl-p" name="principal" inputMode="numeric" value={principal} onChange={e => setPrincipal(e.target.value)} required /></F>
      <F id="nl-f" label="Service charge (Rs)" hint="Flat, added to the amount to repay."><input id="nl-f" name="fee" inputMode="numeric" value={fee} onChange={e => setFee(e.target.value)} required /></F>
      <F id="nl-n" label="Weekly installments"><input id="nl-n" name="n" inputMode="numeric" value={n} onChange={e => setN(e.target.value)} required /></F>
      <div className="field">
        <span className="label-like">Schedule</span>
        <p className="muted" aria-live="polite">
          {ok ? <>{N} × {fmtRs(inst)}{last !== inst ? <> (last one {fmtRs(last)})</> : null}, total {fmtRs(total)}, from {fmtDate(d!, 'en', true)} to {fmtDate(d! + 7 * (N - 1), 'en', true)}.</> : 'Fill in the amounts to see the schedule.'}
        </p>
      </div>
      <div className="span2"><Result state={state} pending={pending} /><button type="submit" className="btn" disabled={pending || !ok}>{pending ? 'Issuing…' : 'Issue loan'}</button></div>
    </form>
  );
}

export function ResetPinForm({ bookId, bid }: { bookId: number; bid: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(resetPin, {});
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="bookId" value={bookId} />
      <input type="hidden" name="bid" value={bid} />
      <input name="pin" inputMode="numeric" maxLength={6} placeholder="New PIN (blank = generate)" aria-label={'New PIN for ' + bid} dir="ltr" />
      <button type="submit" className="btn sm ghost" disabled={pending}>{pending ? 'Saving…' : 'Reset PIN'}</button>
      <Result state={state} pending={pending} />
    </form>
  );
}

export function AddStaffForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(addStaffMember, {});
  return (
    <form action={action} className="form grid3" key={state.ok ?? 'f'}>
      <F id="ns-u" label="Username"><input id="ns-u" name="username" autoCapitalize="none" spellCheck={false} autoComplete="off" required /></F>
      <F id="ns-n" label="Name"><input id="ns-n" name="name" autoComplete="off" required /></F>
      <F id="ns-p" label="Password" hint="At least 8 characters."><input id="ns-p" name="password" type="password" autoComplete="new-password" required /></F>
      <div className="span3"><Result state={state} pending={pending} /><button type="submit" className="btn ghost" disabled={pending}>{pending ? 'Adding…' : 'Add staff member'}</button></div>
    </form>
  );
}
