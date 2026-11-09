import { beforeAll, describe, expect, it } from 'vitest';
import { hashSecret } from '@/lib/auth/password';
import { applicationFor, approveApplication, createApplication, declineApplication, listApplications } from '@/lib/db/applications';
import { memoryConn, type Conn } from '@/lib/db/client';
import { checkBorrowerPin } from '@/lib/db/people';
import { clockFor, currentBook, dbChecks, loadState } from '@/lib/db/store';
import { runChecks } from '@/lib/engine';
import { runSandbox } from '@/lib/sandbox';

let conn: Conn;
beforeAll(async () => { conn = await memoryConn(); });

const failing = async () => {
  const L = await loadState({ conn });
  return [...runChecks(L.S), ...(await dbChecks(L))].filter(c => !c.pass).map(c => c.title + ': ' + c.value);
};

describe('sandbox scenario', () => {
  it('produces and correctly handles every exceptional state, and can run again', async () => {
    for (let run = 0; run < 2; run++) {
      const r = await runSandbox(conn, 'ops: Test');
      expect(r.steps.filter(s => !s.ok).map(s => s.label + ' ' + s.detail)).toEqual([]);
      expect(r.steps.length).toBeGreaterThanOrEqual(19);
      expect(r.borrowers).toHaveLength(4);
      expect(await failing()).toEqual([]);
    }
  }, 60000);

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
