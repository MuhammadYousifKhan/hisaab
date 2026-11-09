import type { Metadata } from 'next';
import Link from 'next/link';
import ApplyForm from '@/components/ApplyForm';

export const metadata: Metadata = { title: 'Apply for a loan' };

export default function ApplyPage() {
  return (
    <section className="panel apply-card">
      <h2>Apply for a loan</h2>
      <p className="muted">No credit history needed. Your repayments here become your record.</p>
      <ApplyForm />
      <p className="muted small">Already have an account? <Link href="/login">Sign in</Link></p>
    </section>
  );
}
