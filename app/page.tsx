import Link from 'next/link';
import { getSession, viewBook } from '@/lib/auth/viewer';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const s = await getSession();
  const book = await viewBook(s);
  const live = book.kind === 'live';
  return (
    <article className="doc">
      <p className="eyebrow">Build for Campus 2026 · FinTech · Challenge HS-0302</p>
      <h1>Every rupee accounted for, whichever way it arrives</h1>
      <p className="lede">
        Borrowers with thin credit files repay a micro-lender through JazzCash, Easypaisa, Raast and cash agents. Hisaab matches each payment to an
        installment and to a bank deposit, explains every adjustment in English or Urdu, keeps confirmed money apart from projections, and proves the
        books still balance.
      </p>
      <p className="muted">
        {live
          ? 'You are looking at the live book: borrowers and loans entered by staff, payments arriving by webhook, file upload or the test simulator, on the real calendar.'
          : 'You are looking at the demo book: twelve synthetic borrowers and a month of payments with planted problems, frozen on 9 Nov 2026. Switch to Live in the top bar for the working app.'}
      </p>
      <div className="home-grid">
        {s?.role === 'borrower' ? (
          <Link href={'/borrower/' + s.bid}><section className="panel"><p className="eyebrow">Signed in as {s.name}</p><h3>My account</h3><p className="muted">What I owe, where my payments are, why my balance changed, my repayment record.</p></section></Link>
        ) : (
          <Link href={s ? '/borrower' : '/login'}><section className="panel"><p className="eyebrow">For borrowers</p><h3>Borrower app</h3><p className="muted">What I owe, where my payment is, why my balance changed, and a repayment record that builds credit history. {s ? '' : 'Sign in with your phone number and PIN.'}</p></section></Link>
        )}
        {s?.role === 'ops' ? (
          <>
            <Link href="/console"><section className="panel"><p className="eyebrow">For lender operations</p><h3>Console</h3><p className="muted">Review queue, borrowers and loans, payment intake, settlements and the full journal.</p></section></Link>
            <Link href="/simulate"><section className="panel"><p className="eyebrow">Test tooling</p><h3>Channel simulator</h3><p className="muted">Send payments, settle batches, reverse a payment and move the clock, until real channels are connected.</p></section></Link>
          </>
        ) : (
          <Link href="/login?as=staff"><section className="panel"><p className="eyebrow">For lender operations</p><h3>Console</h3><p className="muted">Sign in as staff to review unmatched payments, add borrowers and loans, and take payments in.</p></section></Link>
        )}
        <Link href="/proof"><section className="panel"><p className="eyebrow">For judges</p><h3>Proof</h3><p className="muted">Live ledger checks in the engine and in Postgres. No sign-in needed.</p></section></Link>
        <Link href="/blueprint"><section className="panel"><p className="eyebrow">For the team</p><h3>Blueprint</h3><p className="muted">The challenge, the architecture, ledger rules and the data model.</p></section></Link>
      </div>
    </article>
  );
}
