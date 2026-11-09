// Loan applications from the public form. An application is only a request: no borrower, loan or money exists
// until staff approve it, and approval goes through the same append-only path as a borrower added by staff.
import { and, desc, eq, sql } from 'drizzle-orm';
import { verifySecret } from '@/lib/auth/password';
import type { PayCh } from '@/lib/engine';
import type { Conn } from './client';
import { applications, borrowers } from './schema';
import { appendBorrower, appendLoan, type NewLoan } from './store';

export interface NewApplication { name: string; phone: string; work: string; city: string; ch: PayCh; amount: number; weeks: number }
export type AppRow = typeof applications.$inferSelect;

export async function createApplication(conn: Conn, bookId: number, a: NewApplication, pinHash: string): Promise<{ id: number } | { error: 'borrower' | 'pending' }> {
  const [b] = await conn.db.select({ id: borrowers.id }).from(borrowers).where(and(eq(borrowers.bookId, bookId), eq(borrowers.phone, a.phone))).limit(1);
  if (b) return { error: 'borrower' };
  const [p] = await conn.db.select({ id: applications.id }).from(applications).where(and(eq(applications.bookId, bookId), eq(applications.phone, a.phone), eq(applications.status, 'pending'))).limit(1);
  if (p) return { error: 'pending' };
  try {
    const [row] = await conn.db.insert(applications).values({ bookId, name: a.name, phone: a.phone, work: a.work, city: a.city, channel: a.ch, amountPaisa: a.amount, weeks: a.weeks, pinHash }).returning({ id: applications.id });
    return { id: row.id };
  } catch {
    return { error: 'pending' }; // two submissions racing: the unique index keeps one pending application per phone
  }
}

export async function listApplications(conn: Conn, bookId: number, status: 'pending' | 'approved' | 'declined' = 'pending'): Promise<AppRow[]> {
  return conn.db.select().from(applications).where(and(eq(applications.bookId, bookId), eq(applications.status, status))).orderBy(desc(applications.id));
}

export async function pendingCount(conn: Conn, bookId: number): Promise<number> {
  const [{ n }] = await conn.db.select({ n: sql<number>`count(*)::int` }).from(applications).where(and(eq(applications.bookId, bookId), eq(applications.status, 'pending')));
  return Number(n);
}

/** For sign-in: the newest application from this phone whose PIN matches, if no borrower exists yet. */
export async function applicationFor(conn: Conn, bookId: number, phone: string, pin: string): Promise<AppRow | null> {
  const [row] = await conn.db.select().from(applications).where(and(eq(applications.bookId, bookId), eq(applications.phone, phone))).orderBy(desc(applications.id)).limit(1);
  return row && (await verifySecret(pin, row.pinHash)) ? row : null;
}

/** Approve: open the borrower's account with the PIN they chose, issue the loan, and mark the application approved. */
export async function approveApplication(conn: Conn, bookId: number, id: number, loan: Omit<NewLoan, 'bid'>, by: string): Promise<{ bid: string; loanId: string } | { error: string }> {
  const [a] = await conn.db.select().from(applications).where(and(eq(applications.bookId, bookId), eq(applications.id, id))).limit(1);
  if (!a || a.status !== 'pending') return { error: 'That application was already decided.' };
  const b = await appendBorrower(conn, bookId, { name: a.name, nameUr: '', phone: a.phone, work: a.work, workUr: '', city: a.city, ch: a.channel as PayCh }, a.pinHash, by);
  if ('error' in b) return { error: b.error === 'phone' ? 'A borrower with this phone number already exists.' : 'Applications can only be approved in the live book.' };
  const l = await appendLoan(conn, bookId, { ...loan, bid: b.id }, by);
  await conn.db.update(applications).set({ status: 'approved', borrowerId: b.id, decidedBy: by, decidedAt: new Date() }).where(eq(applications.id, id));
  if ('error' in l) return { error: 'Account ' + b.id + ' opened, but the loan was not issued (' + l.error + '). Issue it from the loan form.' };
  return { bid: b.id, loanId: l.id };
}

export async function declineApplication(conn: Conn, bookId: number, id: number, by: string): Promise<boolean> {
  const r = await conn.db.update(applications).set({ status: 'declined', decidedBy: by, decidedAt: new Date() })
    .where(and(eq(applications.bookId, bookId), eq(applications.id, id), eq(applications.status, 'pending'))).returning({ id: applications.id });
  return r.length > 0;
}
