import { beforeAll, describe, expect, it } from 'vitest';
import { memoryConn, type Conn } from '@/lib/db/client';
import { appendAction, dbChecks, dbReplay, dbTryEdit, dbTryUnbalanced, loadState } from '@/lib/db/store';

let conn: Conn;
beforeAll(async () => { conn = await memoryConn(); });

describe('database ledger', () => {
  it('stores the projected journal and every SQL check passes', async () => {
    const L = await loadState(conn);
    expect(L.sync.stored).toBe(L.S.ledger.entries.length);
    const failing = (await dbChecks(L)).filter(c => !c.pass);
    expect(failing).toEqual([]);
  });

  it('Postgres rejects an unbalanced entry and keeps nothing', async () => {
    const L = await loadState(conn);
    const r = await dbTryUnbalanced(conn, L.book.id);
    expect(r.ok).toBe(true);
    expect(r.msg).toMatch(/Rejected by the database/);
  });

  it('Postgres refuses to edit a posted entry', async () => {
    const L = await loadState(conn);
    const r = await dbTryEdit(conn, L.book.id);
    expect(r.ok).toBe(true);
    expect(r.msg).toMatch(/append-only/);
  });

  it('replaying stored files inserts nothing', async () => {
    const L = await loadState(conn);
    const r = await dbReplay(L);
    expect(r.dbInserted).toBe(0);
    expect(r.engineAccepted).toBe(0);
    expect(r.newEntries).toBe(0);
  });

  it('a recorded decision appends new entries and history stays identical', async () => {
    const L0 = await loadState(conn);
    const ex = L0.S.exceptions.find(e => e.kind === 'settlement_short')!;
    await appendAction(conn, L0.book.id, { type: 'accept_fee', exId: ex.id });
    const L1 = await loadState(conn);
    expect(L1.sync.inserted).toBe(1);
    expect(L1.sync.mismatched).toEqual([]);
    const failing = (await dbChecks(L1)).filter(c => !c.pass);
    expect(failing).toEqual([]);
  });
});
