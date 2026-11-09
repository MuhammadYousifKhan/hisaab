// The one way channel data and bank lines reach a live book, used by the webhook API, the console uploads and
// the simulator alike. Payloads are stored before validation, then checked with the same adapter the engine uses,
// so the caller learns straight away whether a payload was accepted, a repeat, or quarantined.
import { timingSafeEqual } from 'node:crypto';
import { ZodError } from 'zod';
import type { Conn } from '@/lib/db/client';
import { getConn } from '@/lib/db/client';
import { appendBank, appendRaw, currentBook, type BankIn, type RawIn } from '@/lib/db/store';
import { normalize } from '@/lib/engine';
import { rawEventFor } from './payloads';

export type IngestStatus = 'accepted' | 'duplicate' | 'quarantined';
export interface IngestResult { status: IngestStatus; id: string; tid: string; error?: string }

export function describeError(err: unknown): string {
  if (err instanceof ZodError) return err.issues.map(i => (i.path.length ? i.path.join('.') + ': ' : '') + i.message).join('; ');
  return err instanceof Error ? err.message : String(err);
}

/** Validate a payload the way the engine will, without storing anything. */
export function checkPayload(it: RawIn): string | null {
  try {
    normalize({ ...rawEventFor(it.ch, it.payload, { day: 0, min: 0 }), id: 'check' });
    return null;
  } catch (err) {
    return describeError(err);
  }
}

export async function ingestPayments(items: RawIn[], conn?: Conn): Promise<{ bookId: number; results: IngestResult[] }> {
  const c = conn ?? (await getConn());
  const book = await currentBook(c, 'live');
  const out = await appendRaw(c, book.id, items);
  const results = out.map((o, i): IngestResult => {
    if (o.duplicate) return { status: 'duplicate', id: o.id, tid: o.tid };
    const error = checkPayload(items[i]);
    return error ? { status: 'quarantined', id: o.id, tid: o.tid, error } : { status: 'accepted', id: o.id, tid: o.tid };
  });
  return { bookId: book.id, results };
}

export async function ingestBank(lines: BankIn[], conn?: Conn) {
  const c = conn ?? (await getConn());
  const book = await currentBook(c, 'live');
  return { bookId: book.id, results: await appendBank(c, book.id, lines) };
}

/** Channels authenticate with a shared bearer token. INGEST_TOKEN sets it; development has a default. */
export const DEV_INGEST_TOKEN = 'hisaab-dev-ingest-token';
export function ingestToken(): string | null {
  if (process.env.INGEST_TOKEN) return process.env.INGEST_TOKEN;
  return process.env.NODE_ENV === 'production' ? null : DEV_INGEST_TOKEN;
}
export function tokenOk(header: string | null): boolean {
  const want = ingestToken();
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!want || !m) return false;
  const a = Buffer.from(m[1].trim()), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}
