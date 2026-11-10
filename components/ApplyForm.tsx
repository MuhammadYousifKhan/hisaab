'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { submitApplication, type ApplyState } from '@/app/apply/actions';
import { ft } from '@/lib/content/forms';
import type { Lang } from '@/lib/engine/types';

export default function ApplyForm({ lang }: { lang: Lang }) {
  const [state, action, pending] = useActionState<ApplyState, FormData>(submitApplication, {});
  const t = (k: Parameters<typeof ft>[1], p?: Record<string, string | number>) => ft(lang, k, p);
  if (state.ok) {
    return (
      <div className="form">
        <p className="msg good" role="status">{t('done')}</p>
        <Link className="btn" href={'/login' + (lang === 'ur' ? '?lang=ur' : '')}>{t('goSignIn')}</Link>
      </div>
    );
  }
  return (
    <form action={action} className="form grid2" noValidate>
      <h3 className="span2">{t('aboutYou')}</h3>
      <div className="field"><label htmlFor="a-name">{t('name')}</label><input id="a-name" name="name" autoComplete="name" required /></div>
      <div className="field"><label htmlFor="a-phone">{t('phone')}</label><input id="a-phone" name="phone" inputMode="tel" autoComplete="tel" dir="ltr" placeholder="0300 1234567" required /></div>
      <div className="field"><label htmlFor="a-city">{t('city')}</label><input id="a-city" name="city" autoComplete="address-level2" required /></div>
      <div className="field" />

      <h3 className="span2">{t('aboutWork')}</h3>
      <div className="field"><label htmlFor="a-work">{t('work')}</label><input id="a-work" name="work" placeholder={t('workPh')} required /></div>
      <div className="field"><label htmlFor="a-years">{t('years')}</label>
        <select id="a-years" name="years" defaultValue="1"><option value="0">{t('y0')}</option><option value="1">{t('y1')}</option><option value="3">{t('y3')}</option></select></div>
      <div className="field"><label htmlFor="a-income">{t('income')}</label><input id="a-income" name="income" inputMode="numeric" dir="ltr" placeholder="30,000" required /><span className="hint">{t('incomeHint')}</span></div>
      <div className="field" />
      <div className="field"><label htmlFor="a-refname">{t('refName')}</label><input id="a-refname" name="refName" placeholder={t('refNamePh')} /></div>
      <div className="field"><label htmlFor="a-refphone">{t('refPhone')}</label><input id="a-refphone" name="refPhone" inputMode="tel" dir="ltr" placeholder="0300 1234567" /></div>

      <h3 className="span2">{t('aboutLoan')}</h3>
      <div className="field"><label htmlFor="a-amt">{t('amount')}</label><input id="a-amt" name="amount" inputMode="numeric" dir="ltr" placeholder={t('amountPh')} required /></div>
      <div className="field"><label htmlFor="a-weeks">{t('weeks')}</label>
        <select id="a-weeks" name="weeks" defaultValue="12">{[4, 8, 12, 16, 20, 26, 39, 52].map(w => <option key={w} value={w}>{t('weeksOpt', { n: w })}</option>)}</select></div>
      <div className="field"><label htmlFor="a-ch">{t('ch')}</label>
        <select id="a-ch" name="ch" defaultValue="JC"><option value="JC">JazzCash</option><option value="EP">Easypaisa</option><option value="CA">Cash agent</option><option value="RA">Bank transfer (Raast)</option></select></div>
      <div className="field" />

      <h3 className="span2">{t('aboutPin')}</h3>
      <div className="field"><label htmlFor="a-pin">{t('pin')}</label><input id="a-pin" name="pin" type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" placeholder={t('pinPh')} dir="ltr" required /></div>
      <div className="field"><label htmlFor="a-pin2">{t('pin2')}</label><input id="a-pin2" name="pin2" type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" dir="ltr" required /></div>
      <div className="span2">
        {!pending && state.error && <p className="err" role="alert">{t(state.error)}</p>}
        <button type="submit" className="btn" disabled={pending}>{pending ? t('sending') : t('submit')}</button>
      </div>
    </form>
  );
}
