'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { expiresIn } from '@/lib/auth/session';
import { clearSession, getSession, safeNext, setSession, setViewKind } from '@/lib/auth/viewer';
import { checkBorrowerPin, checkStaff } from '@/lib/db/people';
import { loadState } from '@/lib/db/store';
import { normPhone } from '@/lib/engine';

export type LoginState = { error?: string };

// Staff sign-in attempts per username, per server process: at most 5 wrong passwords in 5 minutes.
const g = globalThis as unknown as { __hisaabStaffTries?: Map<string, { n: number; until: number }> };
function staffLocked(u: string): number {
  const t = (g.__hisaabStaffTries ??= new Map()).get(u);
  return t && t.n >= 5 && t.until > Date.now() ? Math.ceil((t.until - Date.now()) / 60000) : 0;
}
function staffFailed(u: string) {
  const m = (g.__hisaabStaffTries ??= new Map());
  const t = m.get(u);
  const fresh = !t || t.until < Date.now();
  m.set(u, { n: fresh ? 1 : t.n + 1, until: fresh ? Date.now() + 5 * 60000 : t.until });
}

const BorrowerIn = z.object({
  phone: z.string().max(30), pin: z.string().max(12), book: z.enum(['live', 'demo']), lang: z.enum(['en', 'ur']).catch('en'),
});

export async function signInBorrower(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const p = BorrowerIn.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: 'Enter your phone number and PIN.' };
  const phone = normPhone(p.data.phone), pin = p.data.pin.trim();
  if (!/^03\d{9}$/.test(phone) || !/^\d{4,6}$/.test(pin)) return { error: 'Enter an 11-digit mobile number (03…) and your 4 to 6 digit PIN.' };
  const L = await loadState({ kind: p.data.book });
  const b = L.S.borrowers.find(x => normPhone(x.phone) === phone);
  const wrong = { error: 'That phone number and PIN don’t match. Check both, or ask the lender to reset your PIN.' };
  if (!b) return wrong;
  const r = await checkBorrowerPin(L.conn, L.book, b.id, pin);
  if (!r.ok) {
    if (r.reason === 'locked') return { error: 'Too many wrong PINs. Try again in ' + r.minutes + ' minute' + (r.minutes === 1 ? '' : 's') + ', or ask the lender to reset your PIN.' };
    return wrong;
  }
  await setSession({ role: 'borrower', bookId: L.book.id, bid: b.id, name: b.name, exp: expiresIn() });
  redirect('/borrower/' + b.id + (p.data.lang === 'ur' ? '?lang=ur' : ''));
}

const StaffIn = z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(200), next: z.string().max(300).optional() });

export async function signInStaff(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const p = StaffIn.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: 'Enter your username and password.' };
  const u = p.data.username.trim().toLowerCase();
  const locked = staffLocked(u);
  if (locked) return { error: 'Too many wrong passwords. Try again in ' + locked + ' minute' + (locked === 1 ? '' : 's') + '.' };
  const L = await loadState({ kind: 'live' });
  const s = await checkStaff(L.conn, u, p.data.password);
  if (!s) { staffFailed(u); return { error: 'Wrong username or password.' }; }
  g.__hisaabStaffTries?.delete(u);
  await setSession({ role: 'ops', staffId: s.id, username: s.username, name: s.name, exp: expiresIn() });
  redirect(safeNext(p.data.next) === '/' ? '/console' : safeNext(p.data.next));
}

export async function signOut(): Promise<void> {
  await clearSession();
  redirect('/');
}

export async function switchBook(fd: FormData): Promise<void> {
  const kind = fd.get('kind') === 'live' ? 'live' : 'demo';
  const s = await getSession();
  // A borrower's book is fixed by their sign-in.
  if (s?.role !== 'borrower') await setViewKind(kind);
  const next = safeNext(String(fd.get('next') ?? '/'));
  // Borrower pages and IDs belong to one book, so switching books from one goes back to the console or home.
  redirect(/^\/borrower\/./.test(next) ? (s?.role === 'ops' ? '/borrower' : '/') : next);
}
