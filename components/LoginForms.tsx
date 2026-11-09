'use client';
import { useActionState } from 'react';
import { signIn, type LoginState } from '@/app/login/actions';

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label htmlFor="l-id">Phone number or username</label>
        <input id="l-id" name="id" autoComplete="username" autoCapitalize="none" spellCheck={false} aria-invalid={!!state.error} />
      </div>
      <div className="field">
        <label htmlFor="l-secret">PIN or password</label>
        <input id="l-secret" name="secret" type="password" autoComplete="current-password" aria-invalid={!!state.error} />
      </div>
      {state.error && <p className="err" role="alert">{state.error}</p>}
      <button type="submit" className="btn full" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}
