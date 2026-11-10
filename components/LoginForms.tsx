'use client';
import { useActionState } from 'react';
import { signIn, type LoginState } from '@/app/login/actions';
import { ft } from '@/lib/content/forms';
import type { Lang } from '@/lib/engine/types';

export function LoginForm({ next, lang = 'en' }: { next: string; lang?: Lang }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  const err = state.error ? ft(lang, state.error, { m: state.m ?? 0, unit: ft(lang, state.m === 1 ? 'minute' : 'minutes') }) : null;
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="lang" value={lang} />
      <div className="field">
        <label htmlFor="l-id">{ft(lang, 'lId')}</label>
        <input id="l-id" name="id" autoComplete="username" autoCapitalize="none" spellCheck={false} dir="ltr" aria-invalid={!!err} />
      </div>
      <div className="field">
        <label htmlFor="l-secret">{ft(lang, 'lSecret')}</label>
        <input id="l-secret" name="secret" type="password" autoComplete="current-password" dir="ltr" aria-invalid={!!err} />
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      <button type="submit" className="btn full" disabled={pending}>{pending ? ft(lang, 'lSending') : ft(lang, 'lSubmit')}</button>
    </form>
  );
}
