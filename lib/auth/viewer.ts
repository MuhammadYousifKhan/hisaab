import 'server-only';
// Who is looking, and at which book. Every page and server action goes through here: server actions are
// public endpoints, so each one checks the session itself rather than trusting the page that rendered the form.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getConn } from '@/lib/db/client';
import { currentBook, getBook, loadState, type Book, type Loaded } from '@/lib/db/store';
import { SESSION_COOKIE, signSession, verifySession, type Session } from './session';

export type OpsSession = Extract<Session, { role: 'ops' }>;

const secure = process.env.NODE_ENV === 'production';

export async function getSession(): Promise<Session | null> {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function setSession(s: Session): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, signSession(s), { httpOnly: true, sameSite: 'lax', secure, path: '/', expires: new Date(s.exp) });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The book a viewer is looking at, without building its state (for the top bar). */
export async function viewBook(session?: Session | null): Promise<Book> {
  const s = session === undefined ? await getSession() : session;
  const conn = await getConn();
  if (s?.role === 'borrower') return (await getBook(conn, s.bookId)) ?? currentBook(conn);
  return currentBook(conn);
}

/** The state a viewer should see: a borrower sees their own book; everyone else the live book. */
export async function loadView(session?: Session | null): Promise<Loaded> {
  const s = session === undefined ? await getSession() : session;
  if (s?.role === 'borrower') return loadState({ bookId: s.bookId });
  return loadState();
}

const safeNext = (next?: string) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/');

/** For pages and actions that only lender staff may use. */
export async function requireOps(next?: string): Promise<OpsSession> {
  const s = await getSession();
  if (s?.role === 'ops') return s;
  redirect('/login?as=staff&next=' + encodeURIComponent(safeNext(next)));
}

/** Staff may open any borrower view; a borrower only their own. Anyone else signs in first. */
export async function requireBorrowerView(bid: string, next: string): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login?next=' + encodeURIComponent(safeNext(next)));
  if (s.role === 'borrower' && s.bid !== bid) redirect('/borrower/' + s.bid);
  return s;
}

export const actorName = (s: OpsSession) => 'ops: ' + s.name;
export { safeNext };
