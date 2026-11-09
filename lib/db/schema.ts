// Drizzle table definitions. The DDL below (with triggers) is the source of truth for the database;
// these definitions mirror it for typed queries.
import { bigint, integer, jsonb, pgTable, primaryKey, serial, text, timestamp } from 'drizzle-orm/pg-core';

/** A book is one ledger for one scenario seed. A fresh book starts a new, empty history. */
export const books = pgTable('books', {
  id: serial('id').primaryKey(),
  seed: integer('seed').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable('accounts', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
});

/** Every channel event exactly as received, repeat deliveries included. */
export const rawEvents = pgTable('raw_events', {
  bookId: integer('book_id').notNull(),
  id: text('id').notNull(),
  source: text('source').notNull(),
  channel: text('channel').notNull(),
  day: integer('day').notNull(),
  minute: integer('minute').notNull(),
  txnId: text('txn_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  redelivery: integer('redelivery').notNull().default(0),
  payload: jsonb('payload').notNull(),
}, t => [primaryKey({ columns: [t.bookId, t.id] })]);

export const bankLines = pgTable('bank_lines', {
  bookId: integer('book_id').notNull(),
  id: text('id').notNull(),
  day: integer('day').notNull(),
  minute: integer('minute').notNull(),
  amountPaisa: bigint('amount_paisa', { mode: 'number' }).notNull(),
  narration: text('narration').notNull(),
  ref: text('ref').notNull(),
}, t => [primaryKey({ columns: [t.bookId, t.id] })]);

/** Human input: ops decisions and borrower reports. Replayed in order on top of the channel data. */
export const actions = pgTable('actions', {
  bookId: integer('book_id').notNull(),
  seq: integer('seq').notNull(),
  kind: text('kind').notNull(),
  payload: jsonb('payload').notNull(),
  actor: text('actor').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.bookId, t.seq] })]);

export const journalEntries = pgTable('journal_entries', {
  bookId: integer('book_id').notNull(),
  id: text('id').notNull(),
  day: integer('day').notNull(),
  reason: text('reason').notNull(),
  explanation: text('explanation').notNull(),
  actor: text('actor').notNull(),
  sourceIds: text('source_ids').array().notNull(),
  reverses: text('reverses'),
  contentHash: text('content_hash').notNull(),
  postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.bookId, t.id] })]);

export const journalLines = pgTable('journal_lines', {
  bookId: integer('book_id').notNull(),
  entryId: text('entry_id').notNull(),
  lineNo: integer('line_no').notNull(),
  account: text('account').notNull(),
  borrowerId: text('borrower_id'),
  debitPaisa: bigint('debit_paisa', { mode: 'number' }).notNull().default(0),
  creditPaisa: bigint('credit_paisa', { mode: 'number' }).notNull().default(0),
}, t => [primaryKey({ columns: [t.bookId, t.entryId, t.lineNo] })]);

export const schema = { books, accounts, rawEvents, bankLines, actions, journalEntries, journalLines };

const APPEND_ONLY = ['raw_events', 'bank_lines', 'actions', 'journal_entries', 'journal_lines'];

export const DDL = `
CREATE TABLE IF NOT EXISTS books (id serial PRIMARY KEY, seed integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS accounts (code text PRIMARY KEY, name text NOT NULL, type text NOT NULL);
CREATE TABLE IF NOT EXISTS raw_events (
  book_id integer NOT NULL REFERENCES books(id), id text NOT NULL, source text NOT NULL, channel text NOT NULL,
  day integer NOT NULL, minute integer NOT NULL, txn_id text NOT NULL, idempotency_key text NOT NULL,
  redelivery integer NOT NULL DEFAULT 0, payload jsonb NOT NULL, PRIMARY KEY (book_id, id));
CREATE TABLE IF NOT EXISTS bank_lines (
  book_id integer NOT NULL REFERENCES books(id), id text NOT NULL, day integer NOT NULL, minute integer NOT NULL,
  amount_paisa bigint NOT NULL, narration text NOT NULL, ref text NOT NULL, PRIMARY KEY (book_id, id));
CREATE TABLE IF NOT EXISTS actions (
  book_id integer NOT NULL REFERENCES books(id), seq integer NOT NULL, kind text NOT NULL, payload jsonb NOT NULL,
  actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (book_id, seq));
CREATE TABLE IF NOT EXISTS journal_entries (
  book_id integer NOT NULL REFERENCES books(id), id text NOT NULL, day integer NOT NULL, reason text NOT NULL,
  explanation text NOT NULL, actor text NOT NULL, source_ids text[] NOT NULL, reverses text, content_hash text NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (book_id, id));
CREATE TABLE IF NOT EXISTS journal_lines (
  book_id integer NOT NULL, entry_id text NOT NULL, line_no integer NOT NULL,
  account text NOT NULL REFERENCES accounts(code), borrower_id text,
  debit_paisa bigint NOT NULL DEFAULT 0, credit_paisa bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (book_id, entry_id, line_no),
  FOREIGN KEY (book_id, entry_id) REFERENCES journal_entries(book_id, id),
  CONSTRAINT one_side_only CHECK (debit_paisa >= 0 AND credit_paisa >= 0 AND (debit_paisa = 0) <> (credit_paisa = 0)));

-- Every journal entry must balance. Checked at COMMIT, after all of the entry's lines are in.
CREATE OR REPLACE FUNCTION hisaab_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d bigint; c bigint;
BEGIN
  SELECT COALESCE(SUM(debit_paisa), 0), COALESCE(SUM(credit_paisa), 0) INTO d, c
    FROM journal_lines WHERE book_id = NEW.book_id AND entry_id = NEW.entry_id;
  IF d <> c THEN
    RAISE EXCEPTION 'Rejected by the database: entry % has debits of % paisa but credits of % paisa', NEW.entry_id, d, c;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS journal_lines_balanced ON journal_lines;
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hisaab_entry_balanced();

-- History is never rewritten: corrections are new, reversing entries.
CREATE OR REPLACE FUNCTION hisaab_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rejected by the database: % is append-only. Post a reversing entry instead.', TG_TABLE_NAME;
END $$;
${APPEND_ONLY.map(t => `DROP TRIGGER IF EXISTS ${t}_append_only ON ${t};
CREATE TRIGGER ${t}_append_only BEFORE UPDATE OR DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION hisaab_append_only();`).join('\n')}
`;
