'use server';
// Borrowers, loans and staff accounts. Staff only. Borrowers and loans are append-only inputs to the live book;
// the loan's disbursement entry is posted by the engine, never written here.
import { randomInt } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { hashSecret } from '@/lib/auth/password';
import { actorName, requireOps } from '@/lib/auth/viewer';
import { approveApplication, declineApplication } from '@/lib/db/applications';
import { addStaff, resetBorrowerPin } from '@/lib/db/people';
import { appendBorrower, appendLoan, clockFor, getBook, loadState } from '@/lib/db/store';
import { getConn } from '@/lib/db/client';
import { dayFromIso, fmtDate, fmtRs, isMobile, normPhone, normName } from '@/lib/engine';

export type FormState = { ok?: string; error?: string; pin?: string };

const BookId = z.coerce.number().int().positive();
const Pin = z.string().trim().regex(/^(\d{4,6})?$/, 'PIN must be 4 to 6 digits');
const newPin = () => String(randomInt(0, 10000)).padStart(4, '0');

const NewBorrower = z.object({
  bookId: BookId,
  name: z.string().trim().min(2, 'Enter the borrower’s full name').max(60),
  nameUr: z.string().trim().max(60).default(''),
  phone: z.string().max(30),
  work: z.string().trim().max(60).default(''),
  workUr: z.string().trim().max(60).default(''),
  city: z.string().trim().max(40).default(''),
  ch: z.enum(['EP', 'JC', 'CA', 'RA']),
  pin: Pin,
});

export async function addBorrower(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireOps('/console?tab=people');
  const p = NewBorrower.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Check the form.' };
  const phone = normPhone(p.data.phone);
  if (!isMobile(phone)) return { error: 'Enter a Pakistani mobile number like 0300 1234567.' };
  const conn = await getConn();
  const book = await getBook(conn, p.data.bookId);
  if (!book) return { error: 'Unknown book.' };
  const pin = p.data.pin || newPin();
  const r = await appendBorrower(conn, book.id, { name: p.data.name, nameUr: p.data.nameUr, phone, work: p.data.work, workUr: p.data.workUr, city: p.data.city, ch: p.data.ch }, await hashSecret(pin), actorName(s));
  if ('error' in r) return { error: 'Another borrower already has ' + phone + '.' };
  const L = await loadState({ conn, bookId: book.id });
  const same = L.S.borrowers.filter(b => b.id !== r.id && normName(b.name) === normName(p.data.name));
  revalidatePath('/', 'layout');
  return {
    ok: 'Added ' + r.id + ', ' + p.data.name + '.' + (same.length ? ' Note: ' + same.map(b => b.id).join(', ') + ' has the same name, so payments will not be matched by name alone for either of them.' : ''),
    pin: p.data.pin ? undefined : pin,
  };
}

const NewLoan = z.object({
  bookId: BookId,
  bid: z.string().regex(/^B\d{2,4}$/, 'Choose a borrower'),
  principal: z.coerce.number().int('Whole rupees only').min(1000, 'At least Rs 1,000').max(1_000_000, 'At most Rs 1,000,000'),
  fee: z.coerce.number().int('Whole rupees only').min(0),
  n: z.coerce.number().int().min(4, 'At least 4 weekly installments').max(52, 'At most 52 weekly installments'),
  firstDue: z.string(),
});

export async function issueLoan(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireOps('/console?tab=people');
  const p = NewLoan.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Check the form.' };
  const { bookId, bid, principal, fee, n } = p.data;
  if (fee > principal / 2) return { error: 'The service charge can be at most half the principal.' };
  const conn = await getConn();
  const book = await getBook(conn, bookId);
  if (!book) return { error: 'Unknown book.' };
  const today = clockFor(book).day;
  const firstDue = dayFromIso(p.data.firstDue);
  if (firstDue === null) return { error: 'Choose the first due date.' };
  if (firstDue <= today || firstDue > today + 60) return { error: 'The first installment must fall due between tomorrow and 60 days from today.' };
  const r = await appendLoan(conn, book.id, { bid, principal: principal * 100, fee: fee * 100, n, firstDue }, actorName(s));
  if ('error' in r) {
    const msg = { borrower: 'That borrower is not in this book.', has_loan: 'That borrower already has a loan.', due: 'The first installment must fall due after today.' }[r.error];
    return { error: msg };
  }
  revalidatePath('/', 'layout');
  return { ok: 'Issued ' + r.id + ': ' + fmtRs((principal + fee) * 100) + ' to repay in ' + n + ' weekly installments, the first due ' + fmtDate(firstDue, 'en', true) + '. The disbursement is in the journal.' };
}

export async function resetPin(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireOps('/console?tab=people');
  const p = z.object({ bookId: BookId, bid: z.string().regex(/^B\d{2,4}$/), pin: Pin }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Check the form.' };
  const conn = await getConn();
  const pin = p.data.pin || newPin();
  const ok = await resetBorrowerPin(conn, p.data.bookId, p.data.bid, pin);
  if (!ok) return { error: 'No sign-in found for ' + p.data.bid + '.' };
  return { ok: 'New PIN set for ' + p.data.bid + '. Any lock is cleared.', pin: p.data.pin ? undefined : pin };
}

const NewStaff = z.object({
  username: z.string().trim().toLowerCase().regex(/^(?=.*[a-z])[a-z0-9._-]{3,30}$/, 'Username: 3 to 30 characters with at least one letter'),
  name: z.string().trim().min(2, 'Enter their name').max(60),
  password: z.string().min(8, 'Password: at least 8 characters').max(200),
});

export async function addStaffMember(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireOps('/console?tab=people');
  const p = NewStaff.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Check the form.' };
  const r = await addStaff(await getConn(), p.data.username, p.data.name, p.data.password);
  if ('error' in r) return { error: 'The username ' + p.data.username + ' is taken.' };
  revalidatePath('/console');
  return { ok: 'Added ' + p.data.name + '. They can sign in as ' + p.data.username + '.' };
}

const Approve = z.object({
  bookId: BookId,
  appId: z.coerce.number().int().positive(),
  principal: z.coerce.number().int('Whole rupees only').min(1000, 'At least Rs 1,000').max(1_000_000),
  fee: z.coerce.number().int('Whole rupees only').min(0),
  n: z.coerce.number().int().min(4, 'At least 4 weekly installments').max(52, 'At most 52 weekly installments'),
  firstDue: z.string(),
});
const back = (q: Record<string, string>) => '/console?' + new URLSearchParams({ tab: 'people', ...q }).toString() + '#applications';

/** Approve an application: open the account with the applicant's own PIN and issue the loan. */
export async function approveApp(fd: FormData): Promise<void> {
  const s = await requireOps('/console?tab=people');
  const p = Approve.safeParse(Object.fromEntries(fd));
  if (!p.success) redirect(back({ err: p.error.issues[0]?.message ?? 'Check the form.' }));
  const { bookId, appId, principal, fee, n } = p.data;
  if (fee > principal / 2) redirect(back({ err: 'The service charge can be at most half the principal.' }));
  const conn = await getConn();
  const book = await getBook(conn, bookId);
  if (!book) redirect(back({ err: 'Unknown book.' }));
  const today = clockFor(book).day;
  const firstDue = dayFromIso(p.data.firstDue);
  if (firstDue === null || firstDue <= today || firstDue > today + 60) redirect(back({ err: 'The first installment must fall due between tomorrow and 60 days from today.' }));
  const r = await approveApplication(conn, bookId, appId, { principal: principal * 100, fee: fee * 100, n, firstDue }, actorName(s));
  revalidatePath('/', 'layout');
  if ('error' in r) redirect(back({ err: r.error }));
  redirect(back({ done: 'Approved: account ' + r.bid + ' opened and loan ' + r.loanId + ' issued. The applicant can sign in with their phone and PIN.' }));
}

export async function declineApp(fd: FormData): Promise<void> {
  const s = await requireOps('/console?tab=people');
  const p = z.object({ bookId: BookId, appId: z.coerce.number().int().positive() }).safeParse(Object.fromEntries(fd));
  if (!p.success) redirect(back({ err: 'Invalid request.' }));
  const ok = await declineApplication(await getConn(), p.data.bookId, p.data.appId, actorName(s));
  revalidatePath('/console');
  redirect(back(ok ? { done: 'Application declined.' } : { err: 'That application was already decided.' }));
}
