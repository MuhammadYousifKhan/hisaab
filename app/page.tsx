import Link from 'next/link';
import { getSession } from '@/lib/auth/viewer';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const s = await getSession();
  return (
    <article className="doc">
      <h1>Every rupee accounted for, whichever way it arrives</h1>
      <p className="lede">
        Hisaab matches each repayment, from JazzCash, Easypaisa, Raast or a cash agent, to an installment and to a bank deposit, and explains every adjustment.
      </p>
      <div className="home-grid">
        {s?.role === 'borrower' && <Link href={'/borrower/' + s.bid}><section className="panel"><h3>My account</h3><p className="muted">What I owe and where my payments are.</p></section></Link>}
        {s?.role === 'ops' && (
          <>
            <Link href="/console"><section className="panel"><h3>Console</h3><p className="muted">Review queue, borrowers, loans and payment intake.</p></section></Link>
            <Link href="/simulate"><section className="panel"><h3>Simulator</h3><p className="muted">Send test payments and settlements.</p></section></Link>
          </>
        )}
        {!s && <Link href="/login"><section className="panel"><h3>Sign in</h3><p className="muted">Borrowers and lender staff.</p></section></Link>}
        <Link href="/proof"><section className="panel"><h3>Proof</h3><p className="muted">Live checks that the books balance.</p></section></Link>
      </div>
    </article>
  );
}
