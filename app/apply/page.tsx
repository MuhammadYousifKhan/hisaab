import type { Metadata } from 'next';
import Link from 'next/link';
import ApplyForm from '@/components/ApplyForm';
import { ft } from '@/lib/content/forms';
import { parseLang } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Apply for a loan' };

export default async function ApplyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const lang = parseLang((await searchParams).lang);
  const ur = lang === 'ur';
  return (
    <section className="panel apply-card" dir={ur ? 'rtl' : 'ltr'} lang={lang}>
      <div className="row">
        <h2>{ft(lang, 'applyTitle')}</h2>
        <div className="lang" role="group" aria-label="Language">
          <Link href="/apply" lang="en" aria-current={!ur ? 'true' : undefined}>EN</Link>
          <Link href="/apply?lang=ur" lang="ur" aria-current={ur ? 'true' : undefined}>اردو</Link>
        </div>
      </div>
      <p className="muted">{ft(lang, 'applyLead')}</p>
      <ApplyForm key={lang} lang={lang} />
      <p className="muted small">{ft(lang, 'have')} <Link href={'/login' + (ur ? '?lang=ur' : '')}>{ft(lang, 'signIn')}</Link></p>
    </section>
  );
}
