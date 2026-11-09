import Link from 'next/link';

export default function Home() {
  return (
    <article className="doc">
      <p className="eyebrow">Build for Campus 2026 · FinTech · Challenge HS-0302</p>
      <h1>Every rupee accounted for, whichever way it arrives</h1>
      <p className="lede">
        Borrowers with thin credit files repay a micro-lender through JazzCash, Easypaisa, Raast and cash agents. Hisaab matches each payment to an
        installment and to a bank deposit, explains every adjustment in English or Urdu, keeps confirmed money apart from projections, and proves the
        books still balance. All data here is synthetic.
      </p>
      <div className="home-grid">
        <Link href="/borrower/B01"><section className="panel"><p className="eyebrow">For borrowers</p><h3>Borrower app</h3><p className="muted">What I owe, where my payment is, why my balance changed, and a repayment record that builds credit history.</p></section></Link>
        <Link href="/console"><section className="panel"><p className="eyebrow">For lender operations</p><h3>Lender console</h3><p className="muted">Collections, money in transit, a review queue with one-click fixes, settlements and the full journal.</p></section></Link>
        <Link href="/proof"><section className="panel"><p className="eyebrow">For judges</p><h3>Proof</h3><p className="muted">Live ledger checks in the engine and in Postgres, planted problems vs what the system caught.</p></section></Link>
        <Link href="/blueprint"><section className="panel"><p className="eyebrow">For the team</p><h3>Blueprint</h3><p className="muted">The challenge, the architecture, ledger rules and the data model.</p></section></Link>
      </div>
    </article>
  );
}
