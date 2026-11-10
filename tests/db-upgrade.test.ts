import { describe, expect, it } from 'vitest';
import { listApplications } from '@/lib/db/applications';
import { getConn, type Conn } from '@/lib/db/client';
import { DDL } from '@/lib/db/schema';
import { currentBook } from '@/lib/db/store';

// The columns added to `applications` after the first release. An older database does not have them.
const NEW = ['income_paisa', 'work_years', 'ref_name', 'ref_phone'];
const makeOld = (conn: Conn) => conn.exec('ALTER TABLE applications ' + NEW.map(c => 'DROP COLUMN IF EXISTS ' + c).join(', '));
const hasNew = async (conn: Conn) => {
  const r = (await conn.db.execute(`SELECT column_name FROM information_schema.columns WHERE table_name = 'applications'` as never)) as unknown as { rows: { column_name: string }[] };
  const have = new Set(r.rows.map(x => x.column_name));
  return NEW.every(c => have.has(c));
};
const g = globalThis as unknown as { __hisaabDdl?: string };

describe('a database made by an older version', () => {
  it('gains the new columns when the schema is applied again, and keeps working', async () => {
    const conn = await getConn();
    await makeOld(conn);
    expect(await hasNew(conn)).toBe(false);
    await conn.exec(DDL);
    expect(await hasNew(conn)).toBe(true);
    expect(await listApplications(conn, (await currentBook(conn)).id)).toEqual([]);
  });

  it('is upgraded even when the server was already running with the old schema (dev hot reload)', async () => {
    const conn = await getConn();
    await makeOld(conn);
    // A connection opened by earlier code never recorded which schema it applied.
    delete g.__hisaabDdl;
    const again = await getConn();
    expect(await hasNew(again)).toBe(true);
    expect(await listApplications(again, (await currentBook(again)).id)).toEqual([]);
  });
});
