// Channel webhooks: POST /api/channels/{easypaisa|jazzcash|raast|agent} with "Authorization: Bearer <INGEST_TOKEN>".
// The body is one payload, or an array of up to 500 (an agent network's daily file). Every payload is stored
// exactly as received in the live book; the response says whether each was accepted, a repeat, or quarantined.
import { NextResponse } from 'next/server';
import { SLUG_TO_CH } from '@/lib/ingest/payloads';
import { ingestPayments, tokenOk } from '@/lib/ingest/ingest';

export const dynamic = 'force-dynamic';

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

export async function POST(req: Request, ctx: { params: Promise<{ channel: string }> }) {
  if (!tokenOk(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Missing or wrong token. Send Authorization: Bearer <INGEST_TOKEN>.' }, { status: 401 });
  }
  const { channel } = await ctx.params;
  const ch = SLUG_TO_CH[channel.toLowerCase()];
  if (!ch) return NextResponse.json({ error: 'Unknown channel "' + channel + '". Use easypaisa, jazzcash, raast or agent.' }, { status: 404 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'The body must be JSON.' }, { status: 400 }); }
  const list = Array.isArray(body) ? body : [body];
  if (!list.length || list.length > 500) return NextResponse.json({ error: 'Send between 1 and 500 payloads.' }, { status: 400 });
  if (!list.every(isObj)) return NextResponse.json({ error: 'Each payload must be a JSON object.' }, { status: 400 });

  const { results } = await ingestPayments(list.map(payload => ({ ch, payload })));
  if (!Array.isArray(body)) {
    const r = results[0];
    return NextResponse.json(r, { status: r.status === 'accepted' ? 202 : r.status === 'duplicate' ? 200 : 422 });
  }
  const count = (s: string) => results.filter(r => r.status === s).length;
  return NextResponse.json({ accepted: count('accepted'), duplicate: count('duplicate'), quarantined: count('quarantined'), results }, { status: 200 });
}

export function GET() {
  return NextResponse.json({ error: 'POST a channel payload to this address.' }, { status: 405, headers: { Allow: 'POST' } });
}
