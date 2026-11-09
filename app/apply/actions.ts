'use server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { hashSecret } from '@/lib/auth/password';
import { createApplication } from '@/lib/db/applications';
import { getConn } from '@/lib/db/client';
import { currentBook } from '@/lib/db/store';
import { isMobile, normPhone } from '@/lib/engine';

export type ApplyState = { ok?: boolean; error?: string };

// A public form: at most 5 applications per address per hour, per server process.
const g = globalThis as unknown as { __hisaabApply?: Map<string, number[]> };
function tooMany(ip: string): boolean {
  const m = (g.__hisaabApply ??= new Map());
  const recent = (m.get(ip) ?? []).filter((t: number) => t > Date.now() - 3600_000);
  m.set(ip, recent);
  if (recent.length >= 5) return true;
  recent.push(Date.now());
  return false;
}

const Form = z.object({
  name: z.string().trim().min(2, 'Enter your full name.').max(60),
  phone: z.string().max(30),
  work: z.string().trim().min(2, 'Tell us what work you do.').max(60),
  city: z.string().trim().min(2, 'Enter your city.').max(40),
  ch: z.enum(['EP', 'JC', 'CA', 'RA']),
  amount: z.coerce.number().int('Whole rupees only.').min(5000, 'The smallest loan is Rs 5,000.').max(100000, 'The largest loan is Rs 100,000.'),
  weeks: z.coerce.number().int().min(4, 'Choose between 4 and 52 weeks.').max(52, 'Choose between 4 and 52 weeks.'),
  pin: z.string().regex(/^\d{4,6}$/, 'Your PIN must be 4 to 6 digits.'),
  pin2: z.string(),
});

export async function submitApplication(_prev: ApplyState, fd: FormData): Promise<ApplyState> {
  const p = Form.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Check the form.' };
  if (p.data.pin !== p.data.pin2) return { error: 'The two PINs don’t match.' };
  const phone = normPhone(p.data.phone);
  if (!isMobile(phone)) return { error: 'Enter a mobile number like 0300 1234567.' };
  const h = await headers();
  if (tooMany((h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local')) return { error: 'Too many applications from this connection. Try again later.' };
  const conn = await getConn();
  const book = await currentBook(conn, 'live');
  const r = await createApplication(conn, book.id, { name: p.data.name, phone, work: p.data.work, city: p.data.city, ch: p.data.ch, amount: p.data.amount * 100, weeks: p.data.weeks }, await hashSecret(p.data.pin));
  if ('error' in r) return { error: r.error === 'borrower' ? 'This number already has an account. Sign in instead.' : 'An application from this number is already being reviewed.' };
  return { ok: true };
}
