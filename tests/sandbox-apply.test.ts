import { beforeAll, describe, expect, it } from 'vitest';
import { hashSecret } from '@/lib/auth/password';
import { affordability, applicationFor, approveApplication, createApplication, declineApplication, listApplications } from '@/lib/db/applications';
import { memoryConn, type Conn } from '@/lib/db/client';
import { checkBorrowerPin } from '@/lib/db/people';
import { clockFor, currentBook, dbChecks, loadState } from '@/lib/db/store';
import { runChecks, stateCoverage, traceChecks } from '@/lib/engine';
import { readRecordCode, recordCode } from '@/lib/record';
import { runSandbox } from '@/lib/sandbox';

let conn: Conn;
beforeAll(async () => { conn = await memoryConn(); });

const failing = async () => {
  const L = await loadState({ conn });
  return [...runChecks(L.S), ...traceChecks(L.S), ...(await dbChecks(L))].filter(c => !c.pass).map(c => c.title + ': ' + c.value);
};

describe('sandbox scenario', () => {
  it('produces and correctly handles every exceptional state, and can run again', async () => {
    for (let run = 0; run < 2; run++) {
      const r = await runSandbox(conn, 'ops: Test');
      expect(r.steps.filter(s => !s.ok).map(s => s.label + ' ' + s.detail)).toEqual([]);
      expect(r.steps.length).toBeGreaterThanOrEqual(22);
      expect(r.borrowers).toHaveLength(4);
      expect(await failing()).toEqual([]);
    }
  }, 60000);

  it('the sandbox book shows the exceptional states on Proof, each handled as designed', async () => {
    const S = (await loadState({ conn })).S;
    const rows = stateCoverage(S);
    expect(rows.filter(r => r.bad)).toEqual([]);
    for (const k of ['repeat', 'malformed', 'failed', 'pending', 'partial', 'overpaid', 'duplicate', 'orphan', 'wrongref', 'deposit', 'reversed', 'short', 'claimpaid', 'overset', 'missing', 'report']) {
      expect(rows.find(r => r.key === k)?.count, k).toBeGreaterThan(0);
    }
  });

  it('sandbox borrowers can sign in with the sandbox PIN', async () => {
    const L = await loadState({ conn });
    const b = L.S.borrowers.find(x => x.name.includes('sandbox'))!;
    expect(await checkBorrowerPin(conn, L.book, b.id, '1234')).toEqual({ ok: true });
  });
});

describe('loan applications', () => {
  const form = { name: 'Rukhsana Memon', phone: '03461112233', work: 'Quilt maker', city: 'Shikarpur', ch: 'JC' as const, amount: 2000000, weeks: 12 };

  it('an applicant applies, is reviewed, and signs in with their own PIN once approved', async () => {
    const book = await currentBook(conn);
    const a = await createApplication(conn, book.id, form, await hashSecret('5566'));
    expect('id' in a).toBe(true);
    expect(await createApplication(conn, book.id, form, await hashSecret('5566'))).toEqual({ error: 'pending' });
    expect((await applicationFor(conn, book.id, form.phone, '5566'))?.status).toBe('pending');
    expect(await applicationFor(conn, book.id, form.phone, '0000')).toBeNull();

    const id = (a as { id: number }).id;
    const today = clockFor(book).day;
    const r = await approveApplication(conn, book.id, id, { principal: 2000000, fee: 400000, n: 12, firstDue: today + 7 }, 'ops: Test');
    expect('bid' in r).toBe(true);
    const { bid } = r as { bid: string };
    expect(await approveApplication(conn, book.id, id, { principal: 2000000, fee: 400000, n: 12, firstDue: today + 7 }, 'ops: Test')).toEqual({ error: 'That application was already decided.' });

    const L = await loadState({ conn });
    expect(L.S.bById.get(bid)?.phone).toBe(form.phone);
    expect(L.S.loanByBid.get(bid)?.total).toBe(2400000);
    expect(await checkBorrowerPin(conn, L.book, bid, '5566')).toEqual({ ok: true });
    expect(await createApplication(conn, book.id, form, await hashSecret('1111'))).toEqual({ error: 'borrower' });
    expect(await failing()).toEqual([]);
  });

  it('keeps what a thin-file applicant tells us, and gives staff an affordability guide', async () => {
    const book = await currentBook(conn);
    const a = await createApplication(conn, book.id, { ...form, phone: '03465554433', income: 3000000, workYears: 3, refName: 'Haji Bashir', refPhone: '03001112222' }, await hashSecret('2468'));
    const row = (await listApplications(conn, book.id)).find(x => x.id === (a as { id: number }).id)!;
    expect(row).toMatchObject({ incomePaisa: 3000000, workYears: 3, refName: 'Haji Bashir', refPhone: '03001112222' });
    // Rs 20,000 + 20% over 12 weeks is Rs 2,000 a week; Rs 30,000 a month is about Rs 6,923 a week, so 29%.
    const af = affordability({ amountPaisa: 2000000, weeks: 12, incomePaisa: 3000000 })!;
    expect(af.installment).toBe(200000);
    expect(Math.round(af.share * 100)).toBe(29);
    expect(af.level).toBe('warn');
    expect(af.maxPrincipal).toBe(1700000);
    expect(affordability({ amountPaisa: 2000000, weeks: 12, incomePaisa: null })).toBeNull();
  });

  it('a declined application stays declined and opens nothing', async () => {
    const book = await currentBook(conn);
    const a = await createApplication(conn, book.id, { ...form, phone: '03469998877' }, await hashSecret('7788'));
    const id = (a as { id: number }).id;
    expect(await declineApplication(conn, book.id, id, 'ops: Test')).toBe(true);
    expect(await declineApplication(conn, book.id, id, 'ops: Test')).toBe(false);
    expect((await applicationFor(conn, book.id, '03469998877', '7788'))?.status).toBe('declined');
    expect((await listApplications(conn, book.id)).some(x => x.id === id)).toBe(false);
    const L = await loadState({ conn });
    expect(L.S.borrowers.some(b => b.phone === '03469998877')).toBe(false);
  });
});

describe('verified repayment record links', () => {
  it('a signed link names one borrower in one book, and a changed link is refused', () => {
    const code = recordCode(3, 'B012', 'secret-a');
    expect(readRecordCode(code, 'secret-a')).toEqual({ bookId: 3, bid: 'B012' });
    expect(readRecordCode(code.replace('B012', 'B013'), 'secret-a')).toBeNull();
    expect(readRecordCode(code.replace(/^3-/, '4-'), 'secret-a')).toBeNull();
    expect(readRecordCode(code, 'secret-b')).toBeNull();
    expect(readRecordCode('nonsense', 'secret-a')).toBeNull();
  });
});
