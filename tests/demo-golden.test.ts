import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { build, explain } from '@/lib/engine';
import type { Action } from '@/lib/engine';

// Hashes of the whole demo ledger (entries, explanations in both languages, review items, scorecard), recorded
// before live books were added. If one changes, the demo book's behaviour changed: stored demo books would
// then disagree with a fresh replay, so only update these on purpose.
const GOLDEN: Record<string, string> = {
  s2026: 'c9d3607a86514077275013df9481602fb0b290fb2ac07dba17cb27def66d5a9b',
  s1: 'd62d4858040ca2115f8cc9a3078fde9153afb7034f42227954fd81222e5bd824',
  s77: '8b4aae480c0865c22c23cdcf590064cd2e7e69f3301e51cb8a1a53bc7b2991a9',
  s4242: 'c532278f0afbddc03b9bf269ba3c49c124cd1b0ebc0ab01e0f459e3b20bb2440',
  s99999: '260a75fe63b0cd7f24ee0e184ff36eafd910ac0badf8690996140a3911968d21',
  acts: '1bf900314ecae37737c2e3e966d3381ff44c549ff1921c54d02f8e0c8713a346',
};

function fp(seed: number, acts: Action[] = []) {
  const S = build(seed, acts);
  const h = createHash('sha256');
  for (const e of S.ledger.entries) h.update(JSON.stringify([e.id, e.day, e.reason, e.params, e.lines, e.src, e.actor, e.reverses, explain(e, 'en'), explain(e, 'ur')]));
  h.update(JSON.stringify(S.exceptions.map(x => [x.id, x.kind, x.status, x.day, x.amount, x.suggest, x.resolution])));
  h.update(JSON.stringify(S.score));
  return h.digest('hex');
}

it('the demo book is byte-for-byte what it was before live books', () => {
  const out: Record<string, string> = {};
  for (const s of [2026, 1, 77, 4242, 99999]) out['s' + s] = fp(s);
  const S0 = build(2026);
  const shaz = S0.txnList.find(t => t.truthBid === 'B02' && t.state === 'held')!;
  const acts: Action[] = [{ type: 'report', n: 1, bid: 'B02', ch: 'JC', amount: 300000, day: shaz.day, tid: shaz.tid }];
  const S1 = build(2026, acts);
  acts.push({ type: 'apply', exId: S1.exById.get('EX-RPT-001')!.linked!, bid: 'B02' });
  for (const e of S0.exceptions) {
    if (e.kind === 'possible_duplicate') acts.push({ type: 'refund', exId: e.id });
    if (e.kind === 'settlement_short') acts.push({ type: 'accept_fee', exId: e.id });
    if (e.kind === 'missing_deposit') acts.push({ type: 'claim', exId: e.id });
    if (e.kind === 'reference_conflict') acts.push({ type: 'apply', exId: e.id, bid: 'B03' });
    if (e.kind === 'unexpected_deposit') acts.push({ type: 'apply', exId: e.id, bid: 'B07' });
    if (e.kind === 'reversal') acts.push({ type: 'ack', exId: e.id });
  }
  out.acts = fp(2026, acts);
  expect(out).toEqual(GOLDEN);
});
