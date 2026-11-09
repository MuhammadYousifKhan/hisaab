// Event-sourced storage. Borrowers, loans, channel events, bank lines and human decisions are stored as received;
// the journal is a deterministic projection of them, written append-only with a content hash per entry.
// Every input to a book gets an arrival number (ord) under a row lock on the book, so committed inputs
// are always a prefix in arrival order and replays never rewrite what is already stored.
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { ACCTS, OPS, buildLive, explain, pktNow, replayFiles } from '@/lib/engine';
import type { Action, AcctCode, BankLine, BorrowerIn, Entry, LoanIn, PayCh, RawEvent, State } from '@/lib/engine';
import { rawEventFor } from '@/lib/ingest/payloads';
import { getConn, type Conn } from './client';
import { APPEND_ONLY, actions, bankLines, books, borrowerLogins, borrowers, journalEntries, journalLines, loans, rawEvents } from './schema';

export interface Book { id: number; nextOrd: number; clockOffset: number }
export interface SyncResult { stored: number; inserted: number; mismatched: string[]; extra: string[] }
export interface Loaded { S: State; book: Book; conn: Conn; sync: SyncResult; actionCount: number }
export interface Clock { day: number; min: number }

const chunk = <T,>(xs: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };
const pad = (n: number, w: number) => String(n).padStart(w, '0');

export function entryHash(e: Entry): string {
  return createHash('sha256').update(JSON.stringify([e.id, e.day, e.reason, e.lines, e.src, e.actor, e.reverses])).digest('hex');
}

/* ---------------- Books ---------------- */
// Older databases may also hold books of another kind from early versions; only 'live' books are ever used.
const LIVE = eq(books.kind, 'live');
const bookCols = { id: books.id, nextOrd: books.nextOrd, clockOffset: books.clockOffset };
const toBook = (r: { id: number; nextOrd: number; clockOffset: number }): Book => ({ id: r.id, nextOrd: Number(r.nextOrd), clockOffset: Number(r.clockOffset) });

/** Today in a book: Pakistan time, plus any days the simulator has moved it forward. */
export function clockFor(book: Pick<Book, 'clockOffset'>, now: Clock = pktNow()): Clock {
  return { day: now.day + book.clockOffset, min: now.min };
}

export async function createLiveBook(conn: Conn): Promise<Book> {
  const [b] = await conn.db.insert(books).values({ seed: 0, kind: 'live' }).returning(bookCols);
  return toBook(b);
}

/** The book in use: the newest one, created empty on first use. */
export async function currentBook(conn: Conn): Promise<Book> {
  const [b] = await conn.db.select(bookCols).from(books).where(LIVE).orderBy(desc(books.id)).limit(1);
  return b ? toBook(b) : createLiveBook(conn);
}

export async function getBook(conn: Conn, id: number): Promise<Book | null> {
  const [b] = await conn.db.select(bookCols).from(books).where(and(eq(books.id, id), LIVE)).limit(1);
  return b ? toBook(b) : null;
}

/** Simulator only: move a live book's clock forward. It can never go back, so stored history stays valid. */
export async function advanceClock(conn: Conn, bookId: number, days = 1): Promise<void> {
  if (!Number.isInteger(days) || days < 1 || days > 14) throw new Error('Advance by 1 to 14 days');
  await conn.db.update(books).set({ clockOffset: sql`${books.clockOffset} + ${days}` }).where(and(eq(books.id, bookId), LIVE));
}

/* ---------------- Writing inputs ---------------- */
type Tx = Parameters<Parameters<Conn['db']['transaction']>[0]>[0];
interface Locked { tx: Tx; book: Book; recv: Clock; take: (n: number) => number }

/** Run fn with the book row locked. take(n) hands out the next n arrival numbers. */
async function withBook<T>(conn: Conn, bookId: number, fn: (L: Locked) => Promise<T>): Promise<T> {
  return conn.db.transaction(async tx => {
    const [row] = await tx.select(bookCols).from(books).where(and(eq(books.id, bookId), LIVE)).for('update');
    if (!row) throw new Error('Book ' + bookId + ' not found');
    const book = toBook(row);
    let next = book.nextOrd;
    const take = (n: number) => { const first = next + 1; next += n; return first; };
    const out = await fn({ tx, book, recv: clockFor(book), take });
    if (next !== book.nextOrd) await tx.update(books).set({ nextOrd: next }).where(eq(books.id, bookId));
    return out;
  });
}

export async function appendAction(conn: Conn, bookId: number, action: Action): Promise<number> {
  return withBook(conn, bookId, async ({ tx, recv, take }) => {
    const [{ seq }] = await tx.select({ seq: sql<number>`COALESCE(MAX(${actions.seq}), 0) + 1` }).from(actions).where(eq(actions.bookId, bookId));
    const ord = take(1);
    const payload: Action = { ...action, at: action.at ?? recv.day, ord };
    const actor = action.type === 'report' ? 'borrower: ' + action.bid : action.by || OPS;
    await tx.insert(actions).values({ bookId, seq: Number(seq), kind: action.type, payload, actor, ord });
    return Number(seq);
  });
}

export interface RawIn { ch: PayCh; payload: Record<string, unknown> }
export interface RawOut { id: string; ord: number; key: string; tid: string; duplicate: boolean }

/** Store channel payloads exactly as received, repeat deliveries included (flagged, then ignored by the engine). */
export async function appendRaw(conn: Conn, bookId: number, items: RawIn[]): Promise<RawOut[]> {
  if (!items.length) return [];
  return withBook(conn, bookId, async ({ tx, recv, take }) => {
    const rows = items.map(it => rawEventFor(it.ch, it.payload, recv));
    const keys = Array.from(new Set(rows.map(r => r.key)));
    const seen = new Set<string>();
    for (const part of chunk(keys, 500)) {
      const have = await tx.select({ k: rawEvents.idempotencyKey }).from(rawEvents).where(and(eq(rawEvents.bookId, bookId), inArray(rawEvents.idempotencyKey, part)));
      for (const h of have) seen.add(h.k);
    }
    const first = take(rows.length);
    const out: RawOut[] = [];
    const values = rows.map((r, i) => {
      const ord = first + i, id = 'RE-' + pad(ord, 6), duplicate = seen.has(r.key);
      seen.add(r.key);
      out.push({ id, ord, key: r.key, tid: r.tid, duplicate });
      return { bookId, id, source: r.src, channel: r.ch, day: r.day, minute: r.min, txnId: r.tid, idempotencyKey: r.key, redelivery: duplicate ? 1 : 0, payload: r.payload, ord, recvDay: recv.day, recvMinute: recv.min };
    });
    for (const part of chunk(values, 200)) await tx.insert(rawEvents).values(part);
    return out;
  });
}

export interface BankIn { day: number; min: number | null; amount: number; narration: string; ref: string; key: string; source: string }
export interface BankOut { key: string; id: string | null; duplicate: boolean }

/** Store bank statement lines. A line already stored (same key) is skipped, so re-uploading a file adds nothing. */
export async function appendBank(conn: Conn, bookId: number, lines: BankIn[]): Promise<BankOut[]> {
  if (!lines.length) return [];
  return withBook(conn, bookId, async ({ tx, recv, take }) => {
    const seen = new Set<string>();
    for (const part of chunk(Array.from(new Set(lines.map(l => l.key))), 500)) {
      const have = await tx.select({ k: bankLines.idempotencyKey }).from(bankLines).where(and(eq(bankLines.bookId, bookId), inArray(bankLines.idempotencyKey, part)));
      for (const h of have) if (h.k) seen.add(h.k);
    }
    const fresh = lines.filter(l => { if (seen.has(l.key)) return false; seen.add(l.key); return true; });
    const first = take(fresh.length);
    const ids = new Map<string, string>();
    const values = fresh.map((l, i) => {
      const ord = first + i, id = 'BK-' + pad(ord, 6);
      ids.set(l.key, id);
      return { bookId, id, day: l.day, minute: l.min ?? 9 * 60, amountPaisa: l.amount, narration: l.narration, ref: l.ref, ord, recvDay: recv.day, recvMinute: recv.min, idempotencyKey: l.key, source: l.source };
    });
    for (const part of chunk(values, 200)) await tx.insert(bankLines).values(part);
    return lines.map(l => ({ key: l.key, id: ids.get(l.key) ?? null, duplicate: !ids.has(l.key) }));
  });
}

export interface NewBorrower { name: string; nameUr: string; phone: string; work: string; workUr: string; city: string; ch: PayCh }

/** Add a borrower with a sign-in PIN hash. Returns the new ID, or 'phone' if the number is taken. */
export async function appendBorrower(conn: Conn, bookId: number, b: NewBorrower, pinHash: string, by: string): Promise<{ id: string } | { error: 'phone' }> {
  return withBook(conn, bookId, async ({ tx, recv, take }) => {
    const [dupe] = await tx.select({ id: borrowers.id }).from(borrowers).where(and(eq(borrowers.bookId, bookId), eq(borrowers.phone, b.phone))).limit(1);
    if (dupe) return { error: 'phone' as const };
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(borrowers).where(eq(borrowers.bookId, bookId));
    const id = 'B' + pad(Number(n) + 1, 3);
    await tx.insert(borrowers).values({ bookId, id, ord: take(1), recvDay: recv.day, name: b.name, nameUr: b.nameUr, phone: b.phone, work: b.work, workUr: b.workUr, city: b.city, channel: b.ch, createdBy: by });
    await tx.insert(borrowerLogins).values({ bookId, borrowerId: id, pinHash });
    return { id };
  });
}

export interface NewLoan { bid: string; principal: number; fee: number; n: number; firstDue: number }

/** Issue a loan. The disbursement entry is posted by the engine on the day it is issued. */
export async function appendLoan(conn: Conn, bookId: number, l: NewLoan, by: string): Promise<{ id: string } | { error: 'borrower' | 'has_loan' | 'due' }> {
  return withBook(conn, bookId, async ({ tx, recv, take }) => {
    if (l.firstDue <= recv.day) return { error: 'due' as const };
    const [b] = await tx.select({ id: borrowers.id }).from(borrowers).where(and(eq(borrowers.bookId, bookId), eq(borrowers.id, l.bid))).limit(1);
    if (!b) return { error: 'borrower' as const };
    const [has] = await tx.select({ id: loans.id }).from(loans).where(and(eq(loans.bookId, bookId), eq(loans.borrowerId, l.bid))).limit(1);
    if (has) return { error: 'has_loan' as const };
    const id = 'L' + l.bid.slice(1);
    await tx.insert(loans).values({ bookId, id, ord: take(1), borrowerId: l.bid, principalPaisa: l.principal, feePaisa: l.fee, n: l.n, firstDue: l.firstDue, startDay: recv.day, createdBy: by });
    return { id };
  });
}

/* ---------------- Reading inputs ---------------- */
async function loadChannelInputs(conn: Conn, bookId: number): Promise<{ raw: RawEvent[]; bank: BankLine[] }> {
  const rr = await conn.db.select().from(rawEvents).where(eq(rawEvents.bookId, bookId)).orderBy(asc(rawEvents.id));
  const bb = await conn.db.select().from(bankLines).where(eq(bankLines.bookId, bookId)).orderBy(asc(bankLines.id));
  const opt = (v: number | null) => (v === null || v === undefined ? undefined : Number(v));
  return {
    raw: rr.map(r => ({
      id: r.id, src: r.source, ch: r.channel as PayCh, day: r.day, min: r.minute, tid: r.txnId, key: r.idempotencyKey,
      payload: r.payload as Record<string, unknown>, redelivery: r.redelivery === 1, ord: opt(r.ord), recvDay: opt(r.recvDay), recvMin: opt(r.recvMinute),
    })),
    bank: bb.map(l => ({
      id: l.id, day: l.day, min: l.minute, amount: Number(l.amountPaisa), narration: l.narration, ref: l.ref,
      key: l.idempotencyKey ?? undefined, ord: opt(l.ord), recvDay: opt(l.recvDay), recvMin: opt(l.recvMinute),
    })),
  };
}

async function loadActions(conn: Conn, bookId: number): Promise<Action[]> {
  const rows = await conn.db.select({ payload: actions.payload, ord: actions.ord }).from(actions).where(eq(actions.bookId, bookId)).orderBy(asc(actions.seq));
  return rows.map(r => ({ ...(r.payload as Action), ...(r.ord !== null ? { ord: Number(r.ord) } : {}) }));
}

async function loadPeople(conn: Conn, bookId: number): Promise<{ borrowers: BorrowerIn[]; loans: LoanIn[] }> {
  const bs = await conn.db.select().from(borrowers).where(eq(borrowers.bookId, bookId)).orderBy(asc(borrowers.ord));
  const ls = await conn.db.select().from(loans).where(eq(loans.bookId, bookId)).orderBy(asc(loans.ord));
  return {
    borrowers: bs.map(b => ({ ord: Number(b.ord), recvDay: b.recvDay, id: b.id, name: b.name, ur: b.nameUr || b.name, work: b.work, workUr: b.workUr || b.work, city: b.city, phone: b.phone, ch: b.channel as PayCh })),
    loans: ls.map(l => ({ ord: Number(l.ord), recvDay: l.startDay, id: l.id, bid: l.borrowerId, principal: Number(l.principalPaisa), fee: Number(l.feePaisa), n: l.n, firstDue: l.firstDue })),
  };
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

const g = globalThis as unknown as { __hisaabCache?: Map<number, { key: string; S: State; sync: SyncResult; actionCount: number }> };

export interface LoadOpts { conn?: Conn; bookId?: number }
const isConn = (x: unknown): x is Conn => !!x && typeof x === 'object' && 'db' in x && 'exec' in x;

/** Build (or reuse) the state of a book. Defaults to the book in use. */
export async function loadState(arg?: Conn | LoadOpts): Promise<Loaded> {
  const o: LoadOpts = isConn(arg) ? { conn: arg } : arg ?? {};
  const conn = o.conn ?? (await getConn());
  const book = (o.bookId ? await getBook(conn, o.bookId) : null) ?? (await currentBook(conn));
  const today = clockFor(book).day;
  const key = conn.where + '|' + book.id + '|' + book.nextOrd + '|' + today;
  if (!g.__hisaabCache) g.__hisaabCache = new Map();
  let c = g.__hisaabCache.get(book.id);
  if (!c || c.key !== key) {
    const acts = await loadActions(conn, book.id);
    const inputs = await loadChannelInputs(conn, book.id);
    const S = buildLive({ today, ...(await loadPeople(conn, book.id)), ...inputs, actions: acts });
    const sync = await syncLedger(conn, book.id, S);
    c = { key, S, sync, actionCount: acts.length };
    g.__hisaabCache.set(book.id, c);
    if (g.__hisaabCache.size > 4) g.__hisaabCache.delete(g.__hisaabCache.keys().next().value as number);
  }
  return { S: c.S, book, conn, sync: c.sync, actionCount: c.actionCount };
}

/** Latest inputs to a book, newest first, for the intake log. */
export async function recentInputs(conn: Conn, bookId: number, limit = 50) {
  const rr = await conn.db.select({ id: rawEvents.id, ord: rawEvents.ord, src: rawEvents.source, ch: rawEvents.channel, tid: rawEvents.txnId, key: rawEvents.idempotencyKey, redelivery: rawEvents.redelivery, at: rawEvents.receivedAt })
    .from(rawEvents).where(eq(rawEvents.bookId, bookId)).orderBy(desc(rawEvents.ord), desc(rawEvents.id)).limit(limit);
  const bb = await conn.db.select({ id: bankLines.id, ord: bankLines.ord, src: bankLines.source, ref: bankLines.ref, amount: bankLines.amountPaisa, narration: bankLines.narration, at: bankLines.receivedAt })
    .from(bankLines).where(eq(bankLines.bookId, bookId)).orderBy(desc(bankLines.ord), desc(bankLines.id)).limit(limit);
  const out = [
    ...rr.map(r => ({ kind: 'raw' as const, id: r.id, ord: Number(r.ord ?? 0), src: r.src, label: r.tid, ch: r.ch, redelivery: r.redelivery === 1, amount: null as number | null, at: r.at })),
    ...bb.map(b => ({ kind: 'bank' as const, id: b.id, ord: Number(b.ord ?? 0), src: b.src || 'Bank statement', label: b.ref || b.narration, ch: 'BR', redelivery: false, amount: Number(b.amount), at: b.at })),
  ];
  return out.sort((a, b) => b.ord - a.ord).slice(0, limit);
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

const GUARDS = APPEND_ONLY.length + 1;

export interface DbCheck { title: string; detail: string; pass: boolean; value: string }
export async function dbChecks(L: Loaded): Promise<DbCheck[]> {
  const { conn, book, S, sync } = L;
  const out: DbCheck[] = [];
  const [tb] = await rows(conn, sql`SELECT COALESCE(SUM(debit_paisa - credit_paisa), 0)::float8 AS tb, COUNT(*)::int AS n FROM journal_lines WHERE book_id = ${book.id}`);
  out.push({ title: 'Database trial balance is zero', detail: 'SUM(debit) − SUM(credit) over ' + Number(tb.n) + ' stored journal lines, computed by Postgres.', pass: Number(tb.tb) === 0, value: String(Number(tb.tb)) + ' paisa' });

  const [ub] = await rows(conn, sql`SELECT COUNT(*)::int AS n FROM (SELECT entry_id FROM journal_lines WHERE book_id = ${book.id} GROUP BY entry_id HAVING SUM(debit_paisa) <> SUM(credit_paisa)) x`);
  out.push({ title: 'Postgres finds no unbalanced entry', detail: 'Grouped by entry in SQL; the constraint trigger also blocks any unbalanced entry at commit.', pass: Number(ub.n) === 0, value: Number(ub.n) + ' unbalanced' });

  const ok = sync.mismatched.length === 0 && sync.extra.length === 0 && sync.stored === S.ledger.entries.length;
  out.push({ title: 'Stored journal matches a fresh replay', detail: 'Every stored entry’s SHA-256 hash equals the hash of the entry rebuilt from the stored inputs and decisions (' + sync.stored + ' stored, ' + S.ledger.entries.length + ' rebuilt).', pass: ok, value: ok ? 'identical' : sync.mismatched.length + sync.extra.length + ' differ' });

  const acc = await rows(conn, sql`SELECT account, COALESCE(SUM(debit_paisa - credit_paisa), 0)::float8 AS bal FROM journal_lines WHERE book_id = ${book.id} GROUP BY account`);
  const sqlBal = new Map(acc.map(r => [String(r.account), Number(r.bal)]));
  const diff = (Object.keys(ACCTS) as AcctCode[]).filter(code => (sqlBal.get(code) || 0) !== S.ledger.balance(code));
  out.push({ title: 'SQL account balances match the engine', detail: 'Each of ' + Object.keys(ACCTS).length + ' accounts summed in Postgres and compared with the engine’s balance.', pass: diff.length === 0, value: diff.length ? diff.join(', ') : 'all match' });

  const [tg] = await rows(conn, sql`SELECT COUNT(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND (tgname = 'journal_lines_balanced' OR tgname LIKE '%_append_only')`);
  out.push({ title: 'Database guards are installed', detail: 'One balance trigger on journal lines and append-only triggers on borrowers, loans, raw events, bank lines, decisions, entries and lines.', pass: Number(tg.n) === GUARDS, value: Number(tg.n) + ' of ' + GUARDS });
  return out;
}

export async function dbTryUnbalanced(conn: Conn, bookId: number, day: number): Promise<{ ok: boolean; msg: string }> {
  const id = 'JE-TEST-' + Date.now();
  try {
    await conn.db.transaction(async tx => {
      await tx.insert(journalEntries).values({ bookId, id, day, reason: 'TEST_UNBALANCED', explanation: 'Deliberately unbalanced test entry', actor: 'proof: test', sourceIds: [], contentHash: 'test' });
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

/** Try to rewrite the book's first posted entry. A book with no entries yet tries on a throwaway entry instead. */
export async function dbTryEdit(conn: Conn, bookId: number): Promise<{ ok: boolean; msg: string }> {
  const [first] = await conn.db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.bookId, bookId)).orderBy(asc(journalEntries.id)).limit(1);
  try {
    if (first) {
      await conn.db.update(journalEntries).set({ explanation: 'Quietly edited' }).where(and(eq(journalEntries.bookId, bookId), eq(journalEntries.id, first.id)));
    } else {
      const id = 'JE-TEST-' + Date.now();
      await conn.db.transaction(async tx => {
        await tx.insert(journalEntries).values({ bookId, id, day: 0, reason: 'TEST_EDIT', explanation: 'Throwaway entry', actor: 'proof: test', sourceIds: [], contentHash: 'test' });
        await tx.update(journalEntries).set({ explanation: 'Quietly edited' }).where(and(eq(journalEntries.bookId, bookId), eq(journalEntries.id, id)));
      });
    }
    return { ok: false, msg: 'The database allowed a posted entry to be edited. This is a bug.' };
  } catch (err) {
    return { ok: true, msg: errMsg(err) + (first ? ' (tried ' + first.id + ')' : ' (this book has no entries yet, so a throwaway entry was used and rolled back)') };
  }
}

/** Re-send every stored channel event and bank line to the database and the engine. */
export async function dbReplay(L: Loaded) {
  const { conn, book, S } = L;
  let inserted = 0;
  for (const part of chunk(S.raw, 200)) {
    const r = await conn.db.insert(rawEvents).values(part.map(x => ({ bookId: book.id, id: x.id, source: x.src, channel: x.ch, day: x.day, minute: x.min, txnId: x.tid, idempotencyKey: x.key, redelivery: x.redelivery ? 1 : 0, payload: x.payload, ord: x.ord ?? null, recvDay: x.recvDay ?? null, recvMinute: x.recvMin ?? null }))).onConflictDoNothing().returning({ id: rawEvents.id });
    inserted += r.length;
  }
  for (const part of chunk(S.bank, 200)) {
    const r = await conn.db.insert(bankLines).values(part.map(l => ({ bookId: book.id, id: l.id, day: l.day, minute: l.min, amountPaisa: l.amount, narration: l.narration, ref: l.ref, idempotencyKey: l.key ?? null, ord: l.ord ?? null, recvDay: l.recvDay ?? null, recvMinute: l.recvMin ?? null }))).onConflictDoNothing().returning({ id: bankLines.id });
    inserted += r.length;
  }
  const engine = replayFiles(S);
  return { sent: S.raw.length + S.bank.length, dbInserted: inserted, engineAccepted: engine.accepted, newEntries: engine.newEntries };
}
