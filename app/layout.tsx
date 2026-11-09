import type { Metadata, Viewport } from 'next';
import { Atkinson_Hyperlegible, JetBrains_Mono, Noto_Nastaliq_Urdu, Schibsted_Grotesk } from 'next/font/google';
import Link from 'next/link';
import TopNav, { type NavItem } from '@/components/TopNav';
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
  description: 'Repayments from every channel, matched to installments and bank deposits.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  const book = await viewBook(session);
  const items: NavItem[] = session?.role === 'ops'
    ? [{ href: '/console', match: '/console', label: 'Console' }, { href: '/borrower', match: '/borrower', label: 'Borrowers' },
      { href: '/simulate', match: '/simulate', label: 'Simulator' }, { href: '/proof', match: '/proof', label: 'Proof' }]
    : session?.role === 'borrower'
      ? [{ href: '/borrower/' + session.bid, match: '/borrower', label: 'My account' }]
      : [{ href: '/', match: '/', label: 'Home' }, { href: '/proof', match: '/proof', label: 'Proof' }];
  return (
    <html lang="en" className={[body.variable, display.variable, mono.variable, urdu.variable].join(' ')}>
      {/* Browser extensions (e.g. ColorZilla's cz-shortcut-listen) add attributes to <body> before React hydrates. */}
      <body suppressHydrationWarning>
        <header className="topbar">
          <div className="topbar-in">
            <Link href="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="wordmark">Hisaab</span>
              <span className="wordmark-ur" lang="ur">حساب</span>
            </Link>
            <TopNav items={items} />
            {book.clockOffset > 0 && <span className="synth" title="The simulator has moved this book's date forward">Date: {fmtDate(clockFor(book).day, 'en')} (simulated)</span>}
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
