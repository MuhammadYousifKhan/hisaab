import type { Metadata, Viewport } from 'next';
import { Atkinson_Hyperlegible, JetBrains_Mono, Noto_Nastaliq_Urdu, Schibsted_Grotesk } from 'next/font/google';
import Link from 'next/link';
import { Suspense } from 'react';
import TopNav, { BookSwitch, type NavItem } from '@/components/TopNav';
import { getSession, viewBook } from '@/lib/auth/viewer';
import { clockFor } from '@/lib/db/store';
import { fmtDate } from '@/lib/engine';
import { signOut } from './login/actions';
import './globals.css';

const body = Atkinson_Hyperlegible({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-body', display: 'swap' });
const display = Schibsted_Grotesk({ weight: ['500', '700', '800'], subsets: ['latin'], variable: '--font-display', display: 'swap' });
const mono = JetBrains_Mono({ weight: ['400', '600'], subsets: ['latin'], variable: '--font-mono', display: 'swap' });
const urdu = Noto_Nastaliq_Urdu({ weight: ['400', '700'], subsets: ['arabic'], variable: '--font-urdu', display: 'swap', preload: false });

export const metadata: Metadata = {
  title: { default: 'Hisaab', template: '%s · Hisaab' },
  description: 'Multi-channel payment reconciliation for a micro-lender serving borrowers with thin credit files. Team Aceva, challenge HS-0302.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  const book = await viewBook(session);
  const items: NavItem[] = session?.role === 'ops'
    ? [{ href: '/console', match: '/console', label: 'Console' }, { href: '/borrower', match: '/borrower', label: 'Borrower app' },
      { href: '/simulate', match: '/simulate', label: 'Simulator' }, { href: '/proof', match: '/proof', label: 'Proof' }, { href: '/blueprint', match: '/blueprint', label: 'Blueprint' }]
    : session?.role === 'borrower'
      ? [{ href: '/borrower/' + session.bid, match: '/borrower', label: 'My account' }]
      : [{ href: '/', match: '/', label: 'Home' }, { href: '/proof', match: '/proof', label: 'Proof' }, { href: '/blueprint', match: '/blueprint', label: 'Blueprint' }];
  const live = book.kind === 'live';
  return (
    <html lang="en" className={[body.variable, display.variable, mono.variable, urdu.variable].join(' ')}>
      {/* Browser extensions (e.g. ColorZilla's cz-shortcut-listen) add attributes to <body> before React hydrates. */}
      <body suppressHydrationWarning>
        <header className="topbar">
          <div className="topbar-in">
            <Link href="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="wordmark">Hisaab</span>
              <span className="wordmark-ur" lang="ur">حساب</span>
              <span className="brand-sub">Team Aceva · HS-0302</span>
            </Link>
            <TopNav items={items} />
            <span className={'synth' + (live ? ' live' : '')} title={live ? 'Live book: real dates, data entered in the app' : 'Demo book: synthetic data, frozen on 9 Nov 2026'}>
              {live ? 'Live · ' + fmtDate(clockFor(book).day, 'en') + (book.clockOffset ? ' (simulated +' + book.clockOffset + 'd)' : '') : 'Demo · synthetic'}
            </span>
            {session?.role !== 'borrower' && <Suspense fallback={null}><BookSwitch kind={book.kind} /></Suspense>}
            {session ? (
              <form action={signOut} className="acct">
                <span className="acct-name" title={session.role === 'ops' ? 'Lender staff' : 'Borrower'}>{session.name}</span>
                <button type="submit" className="btn sm ghost">Sign out</button>
              </form>
            ) : (
              <Link className="btn sm" href="/login">Sign in</Link>
            )}
          </div>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
