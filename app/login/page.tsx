import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import LogoMark from '@/components/Logo';
import { LoginForm } from '@/components/LoginForms';
import { getSession, safeNext } from '@/lib/auth/viewer';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (session) redirect(session.role === 'ops' ? '/console' : '/borrower/' + session.bid);
  const next = safeNext(typeof sp.next === 'string' ? sp.next : undefined);
  return (
    <section className="panel login-card">
      <LogoMark size={48} className="card-mark" />
      <h2>Sign in</h2>
      <LoginForm next={next} />
      <p className="muted small mt">New here? <Link href="/apply">Apply for a loan</Link></p>
    </section>
  );
}
