'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { expiresIn } from '@/lib/auth/session';
import type { FormKey } from '@/lib/content/forms';
import { clearSession, safeNext, setSession } from '@/lib/auth/viewer';
import { applicationFor } from '@/lib/db/applications';
import { checkBorrowerPin, checkStaff } from '@/lib/db/people';
import { loadState } from '@/lib/db/store';
import { isMobile, normPhone } from '@/lib/engine';

/** error is a message key (shown in the viewer's language); m is minutes left on a lock. */
export type LoginState = { error?: FormKey; m?: number };

// Sign-in attempts per staff username, per server process: at most 5 wrong passwords in 5 minutes.
// (Borrower PINs are limited in the database.)
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

const wrong: LoginState = { error: 'lWrong' };
const Form = z.object({ id: z.string().trim().min(1).max(60), secret: z.string().min(1).max(200), next: z.string().max(300).optional(), lang: z.string().optional() });

/** One form for everyone: a mobile number and PIN opens a borrower's account; a username and password opens the console. */
export async function signIn(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const p = Form.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: 'lEmpty' };
  const phone = normPhone(p.data.id);
  const L = await loadState();

  if (isMobile(phone)) {
    const b = L.S.borrowers.find(x => normPhone(x.phone) === phone);
    if (!/^\d{4,6}$/.test(p.data.secret.trim())) return wrong;
    if (!b) {
      // Not a borrower yet: an applicant with the right PIN learns where their application stands.
      const a = await applicationFor(L.conn, L.book.id, phone, p.data.secret.trim());
      if (a?.status === 'pending') return { error: 'lPending' };
      if (a?.status === 'declined') return { error: 'lDeclined' };
      return wrong;
    }
    const r = await checkBorrowerPin(L.conn, L.book, b.id, p.data.secret.trim());
    if (!r.ok) {
      if (r.reason === 'locked') return { error: 'lLocked', m: r.minutes };
      return wrong;
    }
    await setSession({ role: 'borrower', bookId: L.book.id, bid: b.id, name: b.name, exp: expiresIn() });
    redirect('/borrower/' + b.id + (p.data.lang === 'ur' ? '?lang=ur' : ''));
  }

  const u = p.data.id.toLowerCase();
  const locked = staffLocked(u);
  if (locked) return { error: 'lStaffLocked', m: locked };
  const s = await checkStaff(L.conn, u, p.data.secret);
  if (!s) { staffFailed(u); return wrong; }
  g.__hisaabStaffTries?.delete(u);
  await setSession({ role: 'ops', staffId: s.id, username: s.username, name: s.name, exp: expiresIn() });
  const next = safeNext(p.data.next);
  redirect(next === '/' ? '/console' : next);
}

export async function signOut(): Promise<void> {
  await clearSession();
  redirect('/login');
}
