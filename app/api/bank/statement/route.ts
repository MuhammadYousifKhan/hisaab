// Bank statement feed: POST /api/bank/statement with "Authorization: Bearer <INGEST_TOKEN>" and a JSON array of
// { date: "2026-11-09", time?: "09:30", amount: "3500.00", narration, ref?, bank_ref? }. Lines already stored are
// skipped, so sending the same statement twice adds nothing. Only credits are taken.
import { NextResponse } from 'next/server';
import { bankLinesFrom, type BankRowIn } from '@/lib/ingest/files';
import { ingestBank, tokenOk } from '@/lib/ingest/ingest';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!tokenOk(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Missing or wrong token. Send Authorization: Bearer <INGEST_TOKEN>.' }, { status: 401 });
  }
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'The body must be JSON.' }, { status: 400 }); }
  const list = Array.isArray(body) ? body : [body];
  if (!list.length || list.length > 2000) return NextResponse.json({ error: 'Send between 1 and 2000 lines.' }, { status: 400 });
  if (!list.every(x => x && typeof x === 'object' && !Array.isArray(x))) return NextResponse.json({ error: 'Each line must be a JSON object.' }, { status: 400 });

  const { lines, errors } = bankLinesFrom(list.map((values, i) => ({ line: i + 1, values: values as BankRowIn })), 'Bank statement API');
  const { results } = lines.length ? await ingestBank(lines) : { results: [] };
  const added = results.filter(r => !r.duplicate).length;
  return NextResponse.json({ added, duplicate: results.length - added, rejected: errors.length, errors, lines: results }, { status: errors.length && !lines.length ? 422 : 200 });
}
