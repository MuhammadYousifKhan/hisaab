import { beforeAll, describe, expect, it } from 'vitest';
import { hashSecret } from '@/lib/auth/password';
import { memoryConn, type Conn } from '@/lib/db/client';
import { checkBorrowerPin } from '@/lib/db/people';
import {
  advanceClock, appendAction, appendBank, appendBorrower, appendLoan, appendRaw, clockFor, createLiveBook, dbChecks, dbTryEdit, loadState, type Book,
} from '@/lib/db/store';
import { iso, runChecks } from '@/lib/engine';
import { paymentPayload } from '@/lib/ingest/payloads';
import { sql } from 'drizzle-orm';

let conn: Conn;
let book: Book;
const failing = async (bookId: number) => {
  const L = await loadState({ conn, bookId });
  return [...runChecks(L.S), ...(await dbChecks(L))].filter(c => !c.pass).map(c => c.title + ': ' + c.value);
};

beforeAll(async () => {
  conn = await memoryConn();
  book = await createLiveBook(conn);
});

describe('live book in Postgres', () => {
  it('starts empty and passes every check, including the edit guard', async () => {
    expect(await failing(book.id)).toEqual([]);
    const r = await dbTryEdit(conn, book.id);
    expect(r.ok).toBe(true);
    expect(r.msg).toMatch(/append-only/);
  });

  it('adds borrowers and loans, refusing a duplicate phone and a past due date', async () => {
    const pin = await hashSecret('4321');
    const a = await appendBorrower(conn, book.id, { name: 'Ali Raza', nameUr: '', phone: '03001234567', work: 'Rickshaw driver', workUr: '', city: 'Sukkur', ch: 'EP' }, pin, 'ops: Test');
    expect(a).toEqual({ id: 'B001' });
    const b = await appendBorrower(conn, book.id, { name: 'Sara Khan', nameUr: '', phone: '03111234567', work: 'Tailor', workUr: '', city: 'Rohri', ch: 'JC' }, pin, 'ops: Test');
    expect(b).toEqual({ id: 'B002' });
    expect(await appendBorrower(conn, book.id, { name: 'Copy', nameUr: '', phone: '03001234567', work: '', workUr: '', city: '', ch: 'EP' }, pin, 'ops: Test')).toEqual({ error: 'phone' });

    const today = clockFor(book).day;
    expect(await appendLoan(conn, book.id, { bid: 'B001', principal: 2000000, fee: 400000, n: 12, firstDue: today }, 'ops: Test')).toEqual({ error: 'due' });
    expect(await appendLoan(conn, book.id, { bid: 'B001', principal: 2000000, fee: 400000, n: 12, firstDue: today + 1 }, 'ops: Test')).toEqual({ id: 'L001' });
    expect(await appendLoan(conn, book.id, { bid: 'B001', principal: 100000, fee: 0, n: 4, firstDue: today + 1 }, 'ops: Test')).toEqual({ error: 'has_loan' });
    expect(await appendLoan(conn, book.id, { bid: 'B009', principal: 100000, fee: 0, n: 4, firstDue: today + 1 }, 'ops: Test')).toEqual({ error: 'borrower' });
    expect(await appendLoan(conn, book.id, { bid: 'B002', principal: 1200000, fee: 240000, n: 12, firstDue: today + 2 }, 'ops: Test')).toEqual({ id: 'L002' });

    const L = await loadState({ conn, bookId: book.id });
    expect(L.S.loans).toHaveLength(2);
    expect(L.S.ledger.entries.filter(e => e.reason === 'LOAN_DISBURSED')).toHaveLength(2);
    expect(await failing(book.id)).toEqual([]);
  });

  it('stores channel payloads as received and flags repeat deliveries', async () => {
    const { day, min } = clockFor(book);
    const p = paymentPayload({ ch: 'EP', tid: 'EP55500001', amount: 200000, phone: '03001234567', name: 'ALI RAZA', ref: '', status: 'success', day, min });
    const q = paymentPayload({ ch: 'JC', tid: 'JC55500002', amount: 120000, phone: '03459990000', name: 'RUBINA', ref: 'silai', status: 'success', day, min });
    const [r1] = await appendRaw(conn, book.id, [{ ch: 'EP', payload: p }]);
    expect(r1.duplicate).toBe(false);
    const [r2, r3] = await appendRaw(conn, book.id, [{ ch: 'EP', payload: p }, { ch: 'JC', payload: q }]);
    expect(r2.duplicate).toBe(true);
    expect(r3.duplicate).toBe(false);

    const L = await loadState({ conn, bookId: book.id });
    expect(L.S.txns.get('EP55500001')).toMatchObject({ state: 'applied', borrowerId: 'B001', rule: 'R2' });
    expect(L.S.txns.get('JC55500002')).toMatchObject({ state: 'held' });
    expect(L.S.ignored).toHaveLength(1);
    expect(await failing(book.id)).toEqual([]);
  });

  it('skips bank lines it already has, so re-uploading a statement adds nothing', async () => {
    const { day } = clockFor(book);
    const line = { day, min: 600, amount: 197600, narration: 'EASYPAISA SETTLEMENT', ref: 'EP-SETL-' + iso(day), key: 'stmt-1', source: 'test' };
    const first = await appendBank(conn, book.id, [line]);
    expect(first[0].duplicate).toBe(false);
    const again = await appendBank(conn, book.id, [line, line]);
    expect(again.every(x => x.duplicate)).toBe(true);
    const L = await loadState({ conn, bookId: book.id });
    expect(L.S.bank).toHaveLength(1);
    expect(L.S.batches.get('EP-SETL-' + iso(day))?.settled).toBe(true);
  });

  it('records who made a decision and when', async () => {
    await appendAction(conn, book.id, { type: 'apply', exId: 'EX-ORP-JC55500002', bid: 'B002', by: 'ops: Asma' });
    const L = await loadState({ conn, bookId: book.id });
    const e = L.S.ledger.entries.find(x => x.reason === 'SUSPENSE_APPLIED')!;
    expect(e.actor).toBe('ops: Asma');
    expect(e.day).toBe(clockFor(L.book).day);
    expect(await failing(book.id)).toEqual([]);
  });

  it('numbers concurrent inputs without gaps or repeats', async () => {
    const { day, min } = clockFor(book);
    await Promise.all(Array.from({ length: 12 }, (_, i) => appendRaw(conn, book.id, [{ ch: 'CA', payload: paymentPayload({ ch: 'CA', tid: 'CA7' + String(100000 + i), amount: 50000, phone: null, name: 'ZZ', ref: '', status: 'success', day, min }) }])));
    const res = (await conn.db.execute(sql`
      SELECT ord FROM raw_events WHERE book_id = ${book.id} UNION ALL SELECT ord FROM bank_lines WHERE book_id = ${book.id}
      UNION ALL SELECT ord FROM actions WHERE book_id = ${book.id} UNION ALL SELECT ord FROM borrowers WHERE book_id = ${book.id}
      UNION ALL SELECT ord FROM loans WHERE book_id = ${book.id} ORDER BY 1`)) as unknown as { rows: { ord: string | number }[] };
    const ords = res.rows.map(r => Number(r.ord));
    expect(ords).toEqual(Array.from({ length: ords.length }, (_, i) => i + 1));
    expect(await failing(book.id)).toEqual([]);
  });

  it('moving the clock forward posts due-date entries without rewriting stored ones', async () => {
    await advanceClock(conn, book.id, 7);
    const L = await loadState({ conn, bookId: book.id });
    expect(L.book.clockOffset).toBe(7);
    expect(L.sync.mismatched).toEqual([]);
    expect(L.S.exceptions.some(e => e.kind === 'missing_deposit')).toBe(true);
    expect(await failing(book.id)).toEqual([]);
  });

  it('locks a borrower out after five wrong PINs', async () => {
    const L = await loadState({ conn, bookId: book.id });
    expect(await checkBorrowerPin(conn, L.book, 'B001', '4321')).toEqual({ ok: true });
    for (let i = 0; i < 4; i++) expect((await checkBorrowerPin(conn, L.book, 'B001', '0000')).ok).toBe(false);
    expect(await checkBorrowerPin(conn, L.book, 'B001', '0000')).toMatchObject({ ok: false, reason: 'locked' });
    expect(await checkBorrowerPin(conn, L.book, 'B001', '4321')).toMatchObject({ ok: false, reason: 'locked' });
    const later = new Date(Date.now() + 6 * 60000);
    expect(await checkBorrowerPin(conn, L.book, 'B001', '4321', later)).toEqual({ ok: true });
  });
});
