'use client';
import { useActionState, useState } from 'react';
import { signInBorrower, signInStaff, type LoginState } from '@/app/login/actions';

export function BorrowerLogin({ book, demo, lang }: { book: 'live' | 'demo'; demo: { phone: string; label: string }[]; lang: 'en' | 'ur' }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signInBorrower, {});
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="book" value={book} />
      <input type="hidden" name="lang" value={lang} />
      {book === 'demo' && demo.length > 0 && (
        <div className="field">
          <label htmlFor="demo-pick">Demo borrower</label>
          <select id="demo-pick" defaultValue="" onChange={e => { setPhone(e.target.value); setPin(e.target.value ? '1234' : ''); }}>
            <option value="">Choose a person to fill in their number…</option>
            {demo.map(d => <option key={d.phone} value={d.phone}>{d.label}</option>)}
          </select>
          <span className="hint">Every demo borrower uses PIN 1234.</span>
        </div>
      )}
      <div className="field">
        <label htmlFor="b-phone">Mobile number <span lang="ur" className="ur-inline">موبائل نمبر</span></label>
        <input id="b-phone" name="phone" inputMode="tel" autoComplete="tel" dir="ltr" placeholder="03XX XXXXXXX" value={phone} onChange={e => setPhone(e.target.value)} aria-invalid={!!state.error} />
      </div>
      <div className="field">
        <label htmlFor="b-pin">PIN <span lang="ur" className="ur-inline">پن</span></label>
        <input id="b-pin" name="pin" type="password" inputMode="numeric" autoComplete="current-password" dir="ltr" maxLength={6} value={pin} onChange={e => setPin(e.target.value)} aria-invalid={!!state.error} />
        <span className="hint">The 4 to 6 digit PIN the lender gave you when your account was opened.</span>
      </div>
      {state.error && <p className="err" role="alert">{state.error}</p>}
      <button type="submit" className="btn full" disabled={pending}>{pending ? 'Signing in…' : 'Sign in to my account'}</button>
    </form>
  );
}

export function StaffLogin({ next, hint }: { next: string; hint: { username: string; password: string } | null }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signInStaff, {});
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label htmlFor="s-user">Username</label>
        <input id="s-user" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} defaultValue={hint?.username} aria-invalid={!!state.error} />
      </div>
      <div className="field">
        <label htmlFor="s-pass">Password</label>
        <input id="s-pass" name="password" type="password" autoComplete="current-password" aria-invalid={!!state.error} />
        {hint && <span className="hint">First run: the starting account is <b className="mono">{hint.username}</b> with password <b className="mono">{hint.password}</b>. Set OPS_USERNAME and OPS_PASSWORD to choose your own.</span>}
      </div>
      {state.error && <p className="err" role="alert">{state.error}</p>}
      <button type="submit" className="btn full" disabled={pending}>{pending ? 'Signing in…' : 'Sign in to the console'}</button>
    </form>
  );
}
