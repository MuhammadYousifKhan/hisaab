import { redirect } from 'next/navigation';
import { getSession, loadView } from '@/lib/auth/viewer';

export const dynamic = 'force-dynamic';

/** Borrowers go to their own account; staff to the first borrower in the book they are viewing. */
export default async function BorrowerIndex() {
  const s = await getSession();
  if (!s) redirect('/login');
  if (s.role === 'borrower') redirect('/borrower/' + s.bid);
  const { S } = await loadView(s);
  redirect(S.borrowers.length ? '/borrower/' + S.borrowers[0].id : '/console?tab=people&empty=1');
}
