'use server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { hashSecret } from '@/lib/auth/password';
import type { FormKey } from '@/lib/content/forms';
import { createApplication } from '@/lib/db/applications';
import { getConn } from '@/lib/db/client';
import { currentBook } from '@/lib/db/store';
import { isMobile, normPhone } from '@/lib/engine';

/** error is a message key, so the form shows it in the applicant's language. */
export type ApplyState = { ok?: boolean; error?: FormKey };

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

const Rupees = (key: FormKey, min: number, max: number) =>
  z.string(key).transform(v => (v.replace(/[,\s]/g, '') ? Number(v.replace(/[,\s]/g, '')) : NaN)).pipe(z.number(key).int(key).min(min, key).max(max, key));

const Form = z.object({
  name: z.string().trim().min(2, 'eName').max(60, 'eName'),
  phone: z.string().max(30, 'ePhone'),
  work: z.string().trim().min(2, 'eWork').max(60, 'eWork'),
  city: z.string().trim().min(2, 'eCity').max(40, 'eCity'),
  ch: z.enum(['EP', 'JC', 'CA', 'RA'], 'eForm'),
  amount: Rupees('eAmount', 5000, 100000),
  weeks: z.coerce.number().int('eWeeks').min(4, 'eWeeks').max(52, 'eWeeks'),
  income: Rupees('eIncome', 1000, 10_000_000),
  years: z.enum(['0', '1', '3'], 'eYears'),
  refName: z.string().trim().max(60, 'eForm').default(''),
  refPhone: z.string().trim().max(30, 'eRefPhone').default(''),
  pin: z.string().regex(/^\d{4,6}$/, 'ePin'),
  pin2: z.string(),
});

export async function submitApplication(_prev: ApplyState, fd: FormData): Promise<ApplyState> {
  const p = Form.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: (p.error.issues[0]?.message as FormKey) ?? 'eForm' };
  if (p.data.pin !== p.data.pin2) return { error: 'ePin2' };
  const phone = normPhone(p.data.phone);
  if (!isMobile(phone)) return { error: 'ePhone' };
  const refPhone = p.data.refPhone ? normPhone(p.data.refPhone) : '';
  if (refPhone && !isMobile(refPhone)) return { error: 'eRefPhone' };
  const h = await headers();
  if (tooMany((h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local')) return { error: 'eTooMany' };
  const conn = await getConn();
  const book = await currentBook(conn);
  const r = await createApplication(conn, book.id, {
    name: p.data.name, phone, work: p.data.work, city: p.data.city, ch: p.data.ch, amount: p.data.amount * 100, weeks: p.data.weeks,
    income: p.data.income * 100, workYears: Number(p.data.years), refName: p.data.refName || null, refPhone: refPhone || null,
  }, await hashSecret(p.data.pin));
  if ('error' in r) return { error: r.error === 'borrower' ? 'eBorrower' : 'ePending' };
  return { ok: true };
}
