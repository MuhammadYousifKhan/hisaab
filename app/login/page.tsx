import type { Metadata } from 'next';
import Link from 'next/link';
import { BorrowerLogin, StaffLogin } from '@/components/LoginForms';
import { getSession, safeNext, viewKind } from '@/lib/auth/viewer';
import { opsFromEnv } from '@/lib/db/client';
import { loadState } from '@/lib/db/store';
import { signOut } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in' };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function LoginPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const session = await getSession();
  const next = safeNext(one(sp.next));
  const book = one(sp.book) === 'live' ? 'live' : one(sp.book) === 'demo' ? 'demo' : await viewKind(session);
  const lang = one(sp.lang) === 'ur' ? 'ur' : 'en';
  const demo = book === 'demo' ? (await loadState({ kind: 'demo' })).S.borrowers.map(b => ({ phone: b.phone, label: b.name + ' · ' + (b.tag ?? b.work) })) : [];
  const ops = opsFromEnv();
  const href = (o: Record<string, string>) => '/login?' + new URLSearchParams({ book, ...(next !== '/' ? { next } : {}), ...o }).toString();

  return (
    <>
      {session && (
        <div className="done" role="status">
          <span>Signed in as {session.name}{session.role === 'ops' ? ' (lender staff)' : ''}.</span>
          <Link href={session.role === 'ops' ? '/console' : '/borrower/' + session.bid}>Continue</Link>
          <form action={signOut}><button type="submit" className="btn sm ghost">Sign out</button></form>
        </div>
      )}
      <div className="login-grid">
        <section className="panel">
          <p className="eyebrow">For borrowers</p>
          <h2>My loan account</h2>
          <p className="muted">See what you owe, where each payment is, and your repayment record.</p>
          <div className="seg" role="group" aria-label="Which book">
            <Link href={href({ book: 'live' })} aria-current={book === 'live' ? 'true' : undefined}>Live book</Link>
            <Link href={href({ book: 'demo' })} aria-current={book === 'demo' ? 'true' : undefined}>Demo book</Link>
          </div>
          <p className="muted small">{book === 'live' ? 'Accounts opened by the lender’s staff.' : 'Twelve synthetic borrowers, each with one real-world payment problem.'}</p>
          <BorrowerLogin key={book} book={book} demo={demo} lang={lang} />
        </section>
        <section className="panel">
          <p className="eyebrow">For lender staff</p>
          <h2>Operations console</h2>
          <p className="muted">Review queue, borrowers and loans, payment intake and the test channel simulator.</p>
          <StaffLogin next={next} hint={ops.isDefault ? { username: ops.username, password: ops.password } : null} />
        </section>
      </div>
      <p className="muted mt">Judges can open the <Link href="/proof">Proof</Link> page without signing in.</p>
    </>
  );
}
