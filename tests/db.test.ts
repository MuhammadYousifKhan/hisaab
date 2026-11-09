import { beforeAll, describe, expect, it } from 'vitest';
import { memoryConn, type Conn } from '@/lib/db/client';
import { appendAction, dbChecks, dbReplay, dbTryEdit, dbTryUnbalanced, loadState } from '@/lib/db/store';
import { explain } from '@/lib/engine';
import { runSandbox } from '@/lib/sandbox';

let conn: Conn;
beforeAll(async () => {
  conn = await memoryConn();
  await runSandbox(conn, 'ops: Test');
});

describe('database ledger', () => {
  it('stores the projected journal and every SQL check passes', async () => {
    const L = await loadState({ conn });
    expect(L.S.ledger.entries.length).toBeGreaterThanOrEqual(15);
    expect(L.sync.stored).toBe(L.S.ledger.entries.length);
    expect((await dbChecks(L)).filter(c => !c.pass)).toEqual([]);
  });

  it('Postgres rejects an unbalanced entry and keeps nothing', async () => {
    const L = await loadState({ conn });
    const r = await dbTryUnbalanced(conn, L.book.id, L.S.today);
    expect(r.ok).toBe(true);
    expect(r.msg).toMatch(/Rejected by the database/);
  });

  it('Postgres refuses to edit a posted entry', async () => {
    const L = await loadState({ conn });
    const r = await dbTryEdit(conn, L.book.id);
    expect(r.ok).toBe(true);
    expect(r.msg).toMatch(/append-only/);
  });

  it('replaying stored files inserts nothing', async () => {
    const r = await dbReplay(await loadState({ conn }));
    expect(r.dbInserted).toBe(0);
    expect(r.engineAccepted).toBe(0);
    expect(r.newEntries).toBe(0);
  });

  it('a recorded decision appends new entries and history stays identical', async () => {
    const L0 = await loadState({ conn });
    const ex = L0.S.exceptions.find(e => e.kind === 'settlement_short' && e.status === 'open')!;
    await appendAction(conn, L0.book.id, { type: 'accept_fee', exId: ex.id, by: 'ops: Test' });
    const L1 = await loadState({ conn });
    expect(L1.sync.inserted).toBe(1);
    expect(L1.sync.mismatched).toEqual([]);
    expect((await dbChecks(L1)).filter(c => !c.pass)).toEqual([]);
  });

  it('every entry a borrower can see is explained in English and Urdu', async () => {
    const { S } = await loadState({ conn });
    const theirs = S.ledger.entries.filter(e => e.lines.some(l => l.sub && S.bById.has(l.sub)));
    expect(theirs.length).toBeGreaterThanOrEqual(8);
    for (const e of theirs) {
      for (const lang of ['en', 'ur'] as const) {
        const s = explain(e, lang);
        expect(s, e.id + ' ' + lang).not.toBe('');
        expect(s, e.id + ' ' + lang).not.toMatch(/undefined|NaN/);
      }
    }
  });
});
