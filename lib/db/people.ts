// Staff accounts and borrower sign-in PINs. These are the only mutable records: passwords change and
// failed sign-ins lock an account for a while. Nothing here touches the ledger.
import { and, asc, eq, sql } from 'drizzle-orm';
import { hashSecret, verifySecret } from '@/lib/auth/password';
import { DEMO_PIN } from '@/lib/auth/demo';
import type { Conn } from './client';
import { borrowerLogins, staff } from './schema';
import type { Book } from './store';

export const MAX_FAILED = 5;
export const LOCK_MINUTES = 5;

export interface StaffRow { id: number; username: string; name: string }

export async function listStaff(conn: Conn): Promise<StaffRow[]> {
  return conn.db.select({ id: staff.id, username: staff.username, name: staff.name }).from(staff).orderBy(asc(staff.id));
}

export async function checkStaff(conn: Conn, username: string, password: string): Promise<StaffRow | null> {
  const [s] = await conn.db.select().from(staff).where(eq(staff.username, username.trim().toLowerCase())).limit(1);
  // Hash even when the user doesn't exist, so response time doesn't reveal valid usernames.
  const ok = await verifySecret(password, s ? s.passHash : 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  return s && ok ? { id: s.id, username: s.username, name: s.name } : null;
}

export async function addStaff(conn: Conn, username: string, name: string, password: string): Promise<{ ok: true } | { error: 'taken' }> {
  const u = username.trim().toLowerCase();
  const [have] = await conn.db.select({ id: staff.id }).from(staff).where(eq(staff.username, u)).limit(1);
  if (have) return { error: 'taken' };
  await conn.db.insert(staff).values({ username: u, name: name.trim(), passHash: await hashSecret(password) });
  return { ok: true };
}

export type PinResult = { ok: true } | { ok: false; reason: 'wrong' | 'locked' | 'no_login'; minutes?: number };

/**
 * Check a borrower's PIN. Demo books use the shared demo PIN. Live books check the stored hash and lock
 * the account for LOCK_MINUTES after MAX_FAILED wrong attempts in a row.
 */
export async function checkBorrowerPin(conn: Conn, book: Book, bid: string, pin: string, now = new Date()): Promise<PinResult> {
  if (book.kind === 'demo') return pin === DEMO_PIN ? { ok: true } : { ok: false, reason: 'wrong' };
  const where = and(eq(borrowerLogins.bookId, book.id), eq(borrowerLogins.borrowerId, bid));
  const [row] = await conn.db.select().from(borrowerLogins).where(where).limit(1);
  if (!row) return { ok: false, reason: 'no_login' };
  if (row.lockedUntil && row.lockedUntil > now) return { ok: false, reason: 'locked', minutes: Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 60000) };
  if (await verifySecret(pin, row.pinHash)) {
    if (row.failed || row.lockedUntil) await conn.db.update(borrowerLogins).set({ failed: 0, lockedUntil: null, updatedAt: now }).where(where);
    return { ok: true };
  }
  const failed = row.failed + 1;
  const lock = failed >= MAX_FAILED ? new Date(now.getTime() + LOCK_MINUTES * 60000) : null;
  await conn.db.update(borrowerLogins).set({ failed: lock ? 0 : failed, lockedUntil: lock, updatedAt: now }).where(where);
  return lock ? { ok: false, reason: 'locked', minutes: LOCK_MINUTES } : { ok: false, reason: 'wrong' };
}

/** Ops sets a new PIN for a borrower (forgotten PIN). Clears any lock. */
export async function resetBorrowerPin(conn: Conn, bookId: number, bid: string, pin: string): Promise<boolean> {
  const pinHash = await hashSecret(pin);
  const res = await conn.db.update(borrowerLogins).set({ pinHash, failed: 0, lockedUntil: null, updatedAt: new Date() })
    .where(and(eq(borrowerLogins.bookId, bookId), eq(borrowerLogins.borrowerId, bid))).returning({ id: borrowerLogins.borrowerId });
  return res.length > 0;
}

export async function staffCount(conn: Conn): Promise<number> {
  const [{ n }] = await conn.db.select({ n: sql<number>`count(*)::int` }).from(staff);
  return Number(n);
}
