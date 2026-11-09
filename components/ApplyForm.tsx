'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { submitApplication, type ApplyState } from '@/app/apply/actions';

export default function ApplyForm() {
  const [state, action, pending] = useActionState<ApplyState, FormData>(submitApplication, {});
  if (state.ok) {
    return (
      <div className="form">
        <p className="msg good" role="status">Application received. Once it is approved, sign in with your mobile number and the PIN you chose.</p>
        <Link className="btn" href="/login">Go to sign in</Link>
      </div>
    );
  }
  return (
    <form action={action} className="form grid2" noValidate>
      <div className="field"><label htmlFor="a-name">Full name</label><input id="a-name" name="name" autoComplete="name" required /></div>
      <div className="field"><label htmlFor="a-phone">Mobile number</label><input id="a-phone" name="phone" inputMode="tel" autoComplete="tel" dir="ltr" placeholder="0300 1234567" required /></div>
      <div className="field"><label htmlFor="a-work">Your work</label><input id="a-work" name="work" placeholder="e.g. tailor, rickshaw driver, shop owner" required /></div>
      <div className="field"><label htmlFor="a-city">City</label><input id="a-city" name="city" autoComplete="address-level2" required /></div>
      <div className="field"><label htmlFor="a-amt">Amount (Rs)</label><input id="a-amt" name="amount" inputMode="numeric" placeholder="5,000 to 100,000" required /></div>
      <div className="field"><label htmlFor="a-weeks">Repay over (weeks)</label>
        <select id="a-weeks" name="weeks" defaultValue="12">{[4, 8, 12, 16, 20, 26, 39, 52].map(w => <option key={w} value={w}>{w} weeks</option>)}</select></div>
      <div className="field"><label htmlFor="a-ch">How you will pay</label>
        <select id="a-ch" name="ch" defaultValue="JC"><option value="JC">JazzCash</option><option value="EP">Easypaisa</option><option value="CA">Cash agent</option><option value="RA">Bank transfer (Raast)</option></select></div>
      <div className="field" />
      <div className="field"><label htmlFor="a-pin">Choose a PIN</label><input id="a-pin" name="pin" type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" placeholder="4 to 6 digits" required /></div>
      <div className="field"><label htmlFor="a-pin2">PIN again</label><input id="a-pin2" name="pin2" type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" required /></div>
      <div className="span2">
        {!pending && state.error && <p className="err" role="alert">{state.error}</p>}
        <button type="submit" className="btn" disabled={pending}>{pending ? 'Sending…' : 'Apply'}</button>
      </div>
    </form>
  );
}
