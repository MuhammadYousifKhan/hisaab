import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import LogoMark from '@/components/Logo';
import { LoginForm } from '@/components/LoginForms';
import { getSession, safeNext } from '@/lib/auth/viewer';
import { ft } from '@/lib/content/forms';
import { parseLang } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (session) redirect(session.role === 'ops' ? '/console' : '/borrower/' + session.bid);
  const next = safeNext(typeof sp.next === 'string' ? sp.next : undefined);
  const lang = parseLang(sp.lang), ur = lang === 'ur';
  const here = (l: string) => '/login?' + new URLSearchParams({ ...(next !== '/' ? { next } : {}), ...(l === 'ur' ? { lang: 'ur' } : {}) }).toString();
  return (
    <section className="panel login-card" dir={ur ? 'rtl' : 'ltr'} lang={lang}>
      <div className="row">
        <LogoMark size={48} className="card-mark" />
        <div className="lang" role="group" aria-label="Language">
          <Link href={here('en')} lang="en" aria-current={!ur ? 'true' : undefined}>EN</Link>
          <Link href={here('ur')} lang="ur" aria-current={ur ? 'true' : undefined}>اردو</Link>
        </div>
      </div>
      <h2>{ft(lang, 'lTitle')}</h2>
      <LoginForm key={lang} next={next} lang={lang} />
      <p className="muted small mt">{ft(lang, 'lNew')} <Link href={'/apply' + (ur ? '?lang=ur' : '')}>{ft(lang, 'lApply')}</Link></p>
    </section>
  );
}
