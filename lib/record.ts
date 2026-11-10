// A borrower's repayment record as portable evidence for applicants with no credit file. The borrower shares a
// link; whoever opens it sees the record recomputed from the ledger at that moment, so it can't be edited or go
// stale. The link is signed with SESSION_SECRET, so a borrower ID can't be guessed into a valid link.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sessionSecret } from '@/lib/auth/session';

const sig = (bookId: number, bid: string, secret: string) =>
  createHmac('sha256', secret).update('record|' + bookId + '|' + bid).digest('base64url').slice(0, 16);

export function recordCode(bookId: number, bid: string, secret = sessionSecret()): string {
  return bookId + '-' + bid + '-' + sig(bookId, bid, secret);
}

export function readRecordCode(code: string, secret = sessionSecret()): { bookId: number; bid: string } | null {
  const m = /^(\d{1,9})-(B\d{2,4})-([A-Za-z0-9_-]{16})$/.exec(String(code));
  if (!m) return null;
  const want = Buffer.from(sig(Number(m[1]), m[2], secret)), got = Buffer.from(m[3]);
  return want.length === got.length && timingSafeEqual(want, got) ? { bookId: Number(m[1]), bid: m[2] } : null;
}
