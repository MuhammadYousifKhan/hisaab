// Drizzle table definitions. The DDL below (with triggers) is the source of truth for the database;
// these definitions mirror it for typed queries.
import { bigint, integer, jsonb, pgTable, primaryKey, serial, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * A book is one ledger. Demo books are generated from a seed and frozen on 9 Nov 2026; live books start
 * empty and follow the real clock. next_ord numbers every input that reaches a book, in arrival order.
 */
export const books = pgTable('books', {
  id: serial('id').primaryKey(),
  seed: integer('seed').notNull(),
  kind: text('kind').notNull().default('demo'),
  nextOrd: bigint('next_ord', { mode: 'number' }).notNull().default(0),
  clockOffset: integer('clock_offset').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable('accounts', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
});

/** Borrowers entered by lender staff (live books). Append-only. */
export const borrowers = pgTable('borrowers', {
  bookId: integer('book_id').notNull(),
  id: text('id').notNull(),
  ord: bigint('ord', { mode: 'number' }).notNull(),
  recvDay: integer('recv_day').notNull(),
  name: text('name').notNull(),
  nameUr: text('name_ur').notNull().default(''),
  phone: text('phone').notNull(),
  work: text('work').notNull().default(''),
  workUr: text('work_ur').notNull().default(''),
  city: text('city').notNull().default(''),
  channel: text('channel').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.bookId, t.id] })]);

/** Loans issued by lender staff (live books). Append-only; one loan per borrower. */
export const loans = pgTable('loans', {
  bookId: integer('book_id').notNull(),
  id: text('id').notNull(),
  ord: bigint('ord', { mode: 'number' }).notNull(),
  borrowerId: text('borrower_id').notNull(),
  principalPaisa: bigint('principal_paisa', { mode: 'number' }).notNull(),
  feePaisa: bigint('fee_paisa', { mode: 'number' }).notNull(),
  n: integer('n').notNull(),
  firstDue: integer('first_due').notNull(),
  startDay: integer('start_day').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.bookId, t.id] })]);

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
  ord: bigint('ord', { mode: 'number' }),
  recvDay: integer('recv_day'),
  recvMinute: integer('recv_minute'),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow(),
}, t => [primaryKey({ columns: [t.bookId, t.id] })]);

export const bankLines = pgTable('bank_lines', {
  bookId: integer('book_id').notNull(),
  id: text('id').notNull(),
  day: integer('day').notNull(),
  minute: integer('minute').notNull(),
  amountPaisa: bigint('amount_paisa', { mode: 'number' }).notNull(),
  narration: text('narration').notNull(),
  ref: text('ref').notNull(),
  ord: bigint('ord', { mode: 'number' }),
  recvDay: integer('recv_day'),
  recvMinute: integer('recv_minute'),
  idempotencyKey: text('idempotency_key'),
  source: text('source'),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow(),
}, t => [primaryKey({ columns: [t.bookId, t.id] })]);

/** Human input: ops decisions and borrower reports. Replayed in order on top of the channel data. */
export const actions = pgTable('actions', {
  bookId: integer('book_id').notNull(),
  seq: integer('seq').notNull(),
  kind: text('kind').notNull(),
  payload: jsonb('payload').notNull(),
  actor: text('actor').notNull(),
  ord: bigint('ord', { mode: 'number' }),
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

/** Lender staff who can sign in to the console. Mutable (passwords change). */
export const staff = pgTable('staff', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  name: text('name').notNull(),
  passHash: text('pass_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Borrower sign-in PINs for live books. Mutable (PIN resets, lockouts). */
export const borrowerLogins = pgTable('borrower_logins', {
  bookId: integer('book_id').notNull(),
  borrowerId: text('borrower_id').notNull(),
  pinHash: text('pin_hash').notNull(),
  failed: integer('failed').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.bookId, t.borrowerId] })]);

export const schema = { books, accounts, borrowers, loans, rawEvents, bankLines, actions, journalEntries, journalLines, staff, borrowerLogins };

export const APPEND_ONLY = ['raw_events', 'bank_lines', 'actions', 'journal_entries', 'journal_lines', 'borrowers', 'loans'];

export const DDL = `
CREATE TABLE IF NOT EXISTS books (id serial PRIMARY KEY, seed integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE books ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'demo';
ALTER TABLE books ADD COLUMN IF NOT EXISTS next_ord bigint NOT NULL DEFAULT 0;
ALTER TABLE books ADD COLUMN IF NOT EXISTS clock_offset integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS accounts (code text PRIMARY KEY, name text NOT NULL, type text NOT NULL);
CREATE TABLE IF NOT EXISTS raw_events (
  book_id integer NOT NULL REFERENCES books(id), id text NOT NULL, source text NOT NULL, channel text NOT NULL,
  day integer NOT NULL, minute integer NOT NULL, txn_id text NOT NULL, idempotency_key text NOT NULL,
  redelivery integer NOT NULL DEFAULT 0, payload jsonb NOT NULL, PRIMARY KEY (book_id, id));
ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS ord bigint;
ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS recv_day integer;
ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS recv_minute integer;
ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS received_at timestamptz DEFAULT now();
CREATE TABLE IF NOT EXISTS bank_lines (
  book_id integer NOT NULL REFERENCES books(id), id text NOT NULL, day integer NOT NULL, minute integer NOT NULL,
  amount_paisa bigint NOT NULL, narration text NOT NULL, ref text NOT NULL, PRIMARY KEY (book_id, id));
ALTER TABLE bank_lines ADD COLUMN IF NOT EXISTS ord bigint;
ALTER TABLE bank_lines ADD COLUMN IF NOT EXISTS recv_day integer;
ALTER TABLE bank_lines ADD COLUMN IF NOT EXISTS recv_minute integer;
ALTER TABLE bank_lines ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE bank_lines ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE bank_lines ADD COLUMN IF NOT EXISTS received_at timestamptz DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS bank_lines_key ON bank_lines (book_id, idempotency_key);
CREATE TABLE IF NOT EXISTS actions (
  book_id integer NOT NULL REFERENCES books(id), seq integer NOT NULL, kind text NOT NULL, payload jsonb NOT NULL,
  actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (book_id, seq));
ALTER TABLE actions ADD COLUMN IF NOT EXISTS ord bigint;
CREATE TABLE IF NOT EXISTS borrowers (
  book_id integer NOT NULL REFERENCES books(id), id text NOT NULL, ord bigint NOT NULL, recv_day integer NOT NULL,
  name text NOT NULL, name_ur text NOT NULL DEFAULT '', phone text NOT NULL, work text NOT NULL DEFAULT '',
  work_ur text NOT NULL DEFAULT '', city text NOT NULL DEFAULT '', channel text NOT NULL, created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (book_id, id), UNIQUE (book_id, phone));
CREATE TABLE IF NOT EXISTS loans (
  book_id integer NOT NULL REFERENCES books(id), id text NOT NULL, ord bigint NOT NULL, borrower_id text NOT NULL,
  principal_paisa bigint NOT NULL CHECK (principal_paisa > 0), fee_paisa bigint NOT NULL CHECK (fee_paisa >= 0),
  n integer NOT NULL CHECK (n BETWEEN 1 AND 104), first_due integer NOT NULL, start_day integer NOT NULL,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, id), UNIQUE (book_id, borrower_id), FOREIGN KEY (book_id, borrower_id) REFERENCES borrowers(book_id, id));
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
CREATE TABLE IF NOT EXISTS staff (
  id serial PRIMARY KEY, username text NOT NULL UNIQUE, name text NOT NULL, pass_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS borrower_logins (
  book_id integer NOT NULL REFERENCES books(id), borrower_id text NOT NULL, pin_hash text NOT NULL,
  failed integer NOT NULL DEFAULT 0, locked_until timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, borrower_id));

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
