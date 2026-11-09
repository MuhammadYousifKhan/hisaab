import type { Metadata, Viewport } from 'next';
import { Atkinson_Hyperlegible, JetBrains_Mono, Noto_Nastaliq_Urdu, Schibsted_Grotesk } from 'next/font/google';
import Link from 'next/link';
import TopNav from '@/components/TopNav';
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={[body.variable, display.variable, mono.variable, urdu.variable].join(' ')}>
      <body>
        <header className="topbar">
          <div className="topbar-in">
            <Link href="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="wordmark">Hisaab</span>
              <span className="wordmark-ur" lang="ur">حساب</span>
              <span className="brand-sub">Team Aceva · HS-0302</span>
            </Link>
            <TopNav />
            <span className="synth">Synthetic data</span>
          </div>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
