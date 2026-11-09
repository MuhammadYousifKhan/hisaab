// Event-sourced storage. Channel events, bank lines and human decisions are stored as received;
// the journal is a deterministic projection of them, written append-only with a content hash per entry.
import { createHash } from 'node:crypto';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { ACCTS, OPS, TODAY, build, explain, generate, replayFiles } from '@/lib/engine';
import type { Action, AcctCode, BankLine, Entry, PayCh, RawEvent, State } from '@/lib/engine';
import { getConn, type Conn } from './client';
import { actions, bankLines, books, journalEntries, journalLines, rawEvents } from './schema';

export const DEFAULT_SEED = 2026;
export interface Book { id: number; seed: number }
export interface SyncResult { stored: number; inserted: number; mismatched: string[]; extra: string[] }
export interface Loaded { S: State; book: Book; conn: Conn; sync: SyncResult; actionCount: number }

const chunk = <T,>(xs: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };

export function entryHash(e: Entry): string {
  return createHash('sha256').update(JSON.stringify([e.id, e.day, e.reason, e.lines, e.src, e.actor, e.reverses])).digest('hex');
}

export async function createBook(conn: Conn, seed: number): Promise<Book> {
  const G = generate(seed);
  return conn.db.transaction(async tx => {
    const [b] = await tx.insert(books).values({ seed }).returning({ id: books.id, seed: books.seed });
    for (const part of chunk(G.raw, 200)) {
      await tx.insert(rawEvents).values(part.map(r => ({ bookId: b.id, id: r.id, source: r.src, channel: r.ch, day: r.day, minute: r.min, txnId: r.tid, idempotencyKey: r.key, redelivery: r.redelivery ? 1 : 0, payload: r.payload })));
    }
    for (const part of chunk(G.bank, 200)) {
      await tx.insert(bankLines).values(part.map(l => ({ bookId: b.id, id: l.id, day: l.day, minute: l.min, amountPaisa: l.amount, narration: l.narration, ref: l.ref })));
    }
    return b;
  });
}

export async function currentBook(conn: Conn): Promise<Book> {
  const [b] = await conn.db.select({ id: books.id, seed: books.seed }).from(books).orderBy(desc(books.id)).limit(1);
  return b ?? createBook(conn, DEFAULT_SEED);
}

async function loadInputs(conn: Conn, bookId: number): Promise<{ raw: RawEvent[]; bank: BankLine[] }> {
  const rr = await conn.db.select().from(rawEvents).where(eq(rawEvents.bookId, bookId)).orderBy(asc(rawEvents.id));
  const bb = await conn.db.select().from(bankLines).where(eq(bankLines.bookId, bookId)).orderBy(asc(bankLines.id));
  return {
    raw: rr.map(r => ({ id: r.id, src: r.source, ch: r.channel as PayCh, day: r.day, min: r.minute, tid: r.txnId, key: r.idempotencyKey, payload: r.payload as Record<string, unknown>, redelivery: r.redelivery === 1 })),
    bank: bb.map(l => ({ id: l.id, day: l.day, min: l.minute, amount: Number(l.amountPaisa), narration: l.narration, ref: l.ref })),
  };
}

async function loadActions(conn: Conn, bookId: number): Promise<Action[]> {
  const rows = await conn.db.select({ payload: actions.payload }).from(actions).where(eq(actions.bookId, bookId)).orderBy(asc(actions.seq));
  return rows.map(r => r.payload as Action);
}

/** Append entries the database doesn't have yet; report any stored entry the replay disagrees with. */
async function syncLedger(conn: Conn, bookId: number, S: State): Promise<SyncResult> {
  const rows = await conn.db.select({ id: journalEntries.id, hash: journalEntries.contentHash }).from(journalEntries).where(eq(journalEntries.bookId, bookId));
  const have = new Map(rows.map(r => [r.id, r.hash]));
  const mine = new Set(S.ledger.entries.map(e => e.id));
  const mismatched: string[] = [];
  const fresh: Entry[] = [];
  for (const e of S.ledger.entries) {
    const old = have.get(e.id);
    if (old === undefined) fresh.push(e);
    else if (old !== entryHash(e)) mismatched.push(e.id);
  }
  const extra = rows.filter(r => !mine.has(r.id)).map(r => r.id);
  if (fresh.length) {
    await conn.db.transaction(async tx => {
      for (const part of chunk(fresh, 150)) {
        await tx.insert(journalEntries).values(part.map(e => ({ bookId, id: e.id, day: e.day, reason: e.reason, explanation: explain(e, 'en'), actor: e.actor, sourceIds: e.src, reverses: e.reverses, contentHash: entryHash(e) }))).onConflictDoNothing();
        await tx.insert(journalLines).values(part.flatMap(e => e.lines.map((l, i) => ({ bookId, entryId: e.id, lineNo: i + 1, account: l.acct, borrowerId: l.sub, debitPaisa: l.dr, creditPaisa: l.cr })))).onConflictDoNothing();
      }
    });
  }
  return { stored: rows.length + fresh.length, inserted: fresh.length, mismatched, extra };
}

const g = globalThis as unknown as { __hisaabCache?: { key: string; S: State; sync: SyncResult } };

export async function loadState(connIn?: Conn): Promise<Loaded> {
  const conn = connIn ?? (await getConn());
  const book = await currentBook(conn);
  const acts = await loadActions(conn, book.id);
  const key = conn.where + '|' + book.id + '|' + acts.length;
  let c = g.__hisaabCache;
  if (!c || c.key !== key) {
    const S = build(book.seed, acts, await loadInputs(conn, book.id));
    const sync = await syncLedger(conn, book.id, S);
    c = { key, S, sync };
    g.__hisaabCache = c;
  }
  return { S: c.S, book, conn, sync: c.sync, actionCount: acts.length };
}

export async function appendAction(conn: Conn, bookId: number, action: Action): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    const [{ next }] = await conn.db.select({ next: sql<number>`COALESCE(MAX(${actions.seq}), 0) + 1` }).from(actions).where(eq(actions.bookId, bookId));
    try {
      await conn.db.insert(actions).values({ bookId, seq: Number(next), kind: action.type, payload: action, actor: action.type === 'report' ? 'borrower: ' + action.bid : OPS });
      return Number(next);
    } catch (err) {
      if (attempt >= 2) throw err;
    }
  }
}

/* ---------------- Database-side proof ---------------- */
export function errMsg(err: unknown): string {
  const seen: string[] = [];
  let e: unknown = err;
  for (let i = 0; e && i < 6; i++) {
    if (e instanceof Error) { seen.push(e.message); e = (e as Error & { cause?: unknown }).cause; } else { seen.push(String(e)); break; }
  }
  return seen.find(m => /Rejected by the database/.test(m)) || seen[seen.length - 1] || 'Unknown error';
}
type Row = Record<string, unknown>;
async function rows(conn: Conn, q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await conn.db.execute(q)) as unknown as { rows: Row[] };
  return res.rows;
}

export interface DbCheck { title: string; detail: string; pass: boolean; value: string }
export async function dbChecks(L: Loaded): Promise<DbCheck[]> {
  const { conn, book, S, sync } = L;
  const out: DbCheck[] = [];
  const [tb] = await rows(conn, sql`SELECT COALESCE(SUM(debit_paisa - credit_paisa), 0)::float8 AS tb, COUNT(*)::int AS n FROM journal_lines WHERE book_id = ${book.id}`);
  out.push({ title: 'Database trial balance is zero', detail: 'SUM(debit) − SUM(credit) over ' + Number(tb.n) + ' stored journal lines, computed by Postgres.', pass: Number(tb.tb) === 0, value: String(Number(tb.tb)) + ' paisa' });

  const [ub] = await rows(conn, sql`SELECT COUNT(*)::int AS n FROM (SELECT entry_id FROM journal_lines WHERE book_id = ${book.id} GROUP BY entry_id HAVING SUM(debit_paisa) <> SUM(credit_paisa)) x`);
  out.push({ title: 'Postgres finds no unbalanced entry', detail: 'Grouped by entry in SQL; the constraint trigger also blocks any unbalanced entry at commit.', pass: Number(ub.n) === 0, value: Number(ub.n) + ' unbalanced' });

  const ok = sync.mismatched.length === 0 && sync.extra.length === 0 && sync.stored === S.ledger.entries.length;
  out.push({ title: 'Stored journal matches a fresh replay', detail: 'Every stored entry’s SHA-256 hash equals the hash of the entry rebuilt from the raw inputs and decisions (' + sync.stored + ' stored, ' + S.ledger.entries.length + ' rebuilt).', pass: ok, value: ok ? 'identical' : sync.mismatched.length + sync.extra.length + ' differ' });

  const acc = await rows(conn, sql`SELECT account, COALESCE(SUM(debit_paisa - credit_paisa), 0)::float8 AS bal FROM journal_lines WHERE book_id = ${book.id} GROUP BY account`);
  const sqlBal = new Map(acc.map(r => [String(r.account), Number(r.bal)]));
  const diff = (Object.keys(ACCTS) as AcctCode[]).filter(code => (sqlBal.get(code) || 0) !== S.ledger.balance(code));
  out.push({ title: 'SQL account balances match the engine', detail: 'Each of ' + Object.keys(ACCTS).length + ' accounts summed in Postgres and compared with the engine’s balance.', pass: diff.length === 0, value: diff.length ? diff.join(', ') : 'all match' });

  const [tg] = await rows(conn, sql`SELECT COUNT(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND (tgname = 'journal_lines_balanced' OR tgname LIKE '%_append_only')`);
  out.push({ title: 'Database guards are installed', detail: 'One balance trigger on journal lines and append-only triggers on raw events, bank lines, decisions, entries and lines.', pass: Number(tg.n) === 6, value: Number(tg.n) + ' of 6' });
  return out;
}

export async function dbTryUnbalanced(conn: Conn, bookId: number): Promise<{ ok: boolean; msg: string }> {
  const id = 'JE-TEST-' + Date.now();
  try {
    await conn.db.transaction(async tx => {
      await tx.insert(journalEntries).values({ bookId, id, day: TODAY, reason: 'TEST_UNBALANCED', explanation: 'Deliberately unbalanced test entry', actor: 'proof: test', sourceIds: [], contentHash: 'test' });
      await tx.insert(journalLines).values([
        { bookId, entryId: id, lineNo: 1, account: '1000', debitPaisa: 1000000, creditPaisa: 0 },
        { bookId, entryId: id, lineNo: 2, account: '2100', debitPaisa: 0, creditPaisa: 990000 },
      ]);
    });
    return { ok: false, msg: 'The database accepted an unbalanced entry. This is a bug.' };
  } catch (err) {
    const [left] = await rows(conn, sql`SELECT COUNT(*)::int AS n FROM journal_entries WHERE book_id = ${bookId} AND id = ${id}`);
    return { ok: Number(left.n) === 0, msg: errMsg(err) + (Number(left.n) === 0 ? ' Nothing was written.' : '') };
  }
}

export async function dbTryEdit(conn: Conn, bookId: number): Promise<{ ok: boolean; msg: string }> {
  try {
    await conn.db.update(journalEntries).set({ explanation: 'Quietly edited' }).where(sql`${journalEntries.bookId} = ${bookId} AND ${journalEntries.id} = 'JE-0001'`);
    return { ok: false, msg: 'The database allowed a posted entry to be edited. This is a bug.' };
  } catch (err) {
    return { ok: true, msg: errMsg(err) };
  }
}

/** Re-send every stored channel event and bank line to the database and the engine. */
export async function dbReplay(L: Loaded) {
  const { conn, book, S } = L;
  let inserted = 0;
  for (const part of chunk(S.raw, 200)) {
    const r = await conn.db.insert(rawEvents).values(part.map(x => ({ bookId: book.id, id: x.id, source: x.src, channel: x.ch, day: x.day, minute: x.min, txnId: x.tid, idempotencyKey: x.key, redelivery: x.redelivery ? 1 : 0, payload: x.payload }))).onConflictDoNothing().returning({ id: rawEvents.id });
    inserted += r.length;
  }
  for (const part of chunk(S.bank, 200)) {
    const r = await conn.db.insert(bankLines).values(part.map(l => ({ bookId: book.id, id: l.id, day: l.day, minute: l.min, amountPaisa: l.amount, narration: l.narration, ref: l.ref }))).onConflictDoNothing().returning({ id: bankLines.id });
    inserted += r.length;
  }
  const engine = replayFiles(S);
  return { sent: S.raw.length + S.bank.length, dbInserted: inserted, engineAccepted: engine.accepted, newEntries: engine.newEntries };
}
