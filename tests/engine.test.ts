import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { borrowerSummary, build, explain, forecastTotal, kpis, normalize, replayFiles, runChecks, tryUnbalanced } from '@/lib/engine';
import type { Action, State } from '@/lib/engine';

const failing = (S: State) => runChecks(S).filter(c => !c.pass).map(c => c.title + ': ' + c.value);

describe('ledger invariants', () => {
  it('pass for the demo seed', () => {
    const S = build(2026);
    expect(failing(S)).toEqual([]);
  });

  it('pass for any seed (property test)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2_000_000_000 }), seed => {
        const S = build(seed);
        expect(failing(S)).toEqual([]);
        expect(S.score.caught).toBe(S.score.injected);
        expect(S.score.correct).toBe(S.score.auto);
      }),
      { numRuns: 40 },
    );
  });

  it('rejects an unbalanced entry and writes nothing', () => {
    const S = build(2026);
    const before = S.ledger.entries.length;
    const r = tryUnbalanced(S);
    expect(r.ok).toBe(true);
    expect(r.msg).toMatch(/do not equal/);
    expect(S.ledger.entries.length).toBe(before);
  });

  it('replaying every file changes nothing', () => {
    const S = build(2026);
    const r = replayFiles(S);
    expect(r.accepted).toBe(0);
    expect(r.newEntries).toBe(0);
    expect(r.rejected).toBe(r.sent);
  });

  it('is deterministic for the same seed', () => {
    const a = build(77), b = build(77);
    expect(JSON.stringify(a.ledger.entries)).toBe(JSON.stringify(b.ledger.entries));
  });
});

describe('scripted stories', () => {
  const S = build(2026);
  it('Ali: split payment leaves Rs 50 credit', () => {
    const sum = borrowerSummary(S, 'B01');
    expect(sum.credit).toBe(5000);
    expect(sum.insts.find(i => i.no === 10)?.status).toBe('ontime');
  });
  it('raises one review item per scripted problem', () => {
    const kinds = S.exceptions.map(e => e.kind);
    for (const k of ['settlement_short', 'reference_conflict', 'unexpected_deposit', 'reversal', 'possible_duplicate', 'missing_deposit'] as const) {
      expect(kinds).toContain(k);
    }
  });
  it('projection is a range and never posted', () => {
    const f = forecastTotal(S);
    expect(f.low).toBeLessThanOrEqual(f.mid);
    expect(f.mid).toBeLessThanOrEqual(f.high);
    expect(S.ledger.entries.some(e => /FORECAST|PROJECT/.test(e.reason))).toBe(false);
  });
});

describe('end-to-end demo flow', () => {
  it('Shazia reports, ops applies, everything still balances', () => {
    const S0 = build(2026);
    const shaz = S0.txnList.find(t => t.truthBid === 'B02' && t.state === 'held')!;
    const actions: Action[] = [{ type: 'report', n: 1, bid: 'B02', ch: 'JC', amount: 300000, day: shaz.day, tid: shaz.tid }];
    const S1 = build(2026, actions);
    const rpt = S1.exById.get('EX-RPT-001')!;
    expect(rpt.finding).toBe('held');
    actions.push({ type: 'apply', exId: rpt.linked!, bid: 'B02' });
    for (const e of S0.exceptions) {
      if (e.kind === 'possible_duplicate') actions.push({ type: 'refund', exId: e.id });
      if (e.kind === 'settlement_short') actions.push({ type: 'accept_fee', exId: e.id });
      if (e.kind === 'missing_deposit') actions.push({ type: 'claim', exId: e.id });
      if (e.kind === 'reference_conflict') actions.push({ type: 'apply', exId: e.id, bid: 'B03' });
      if (e.kind === 'unexpected_deposit') actions.push({ type: 'apply', exId: e.id, bid: 'B07' });
      if (e.kind === 'reversal') actions.push({ type: 'ack', exId: e.id });
    }
    const S2 = build(2026, actions);
    expect(failing(S2)).toEqual([]);
    expect(S2.exById.get('EX-RPT-001')!.status).toBe('resolved');
    const sum = borrowerSummary(S2, 'B02');
    expect(sum.overdue.length).toBe(0);
    const latest = sum.changes[0];
    expect(explain(latest, 'en')).toMatch(/another number/);
    expect(explain(latest, 'ur')).toMatch(/دوسرے نمبر/);
    expect(kpis(S2).open).toBeGreaterThanOrEqual(0);
  });
});

describe('adapters', () => {
  it('reject a malformed payload', () => {
    expect(() => normalize({ id: 'X', src: 'test', ch: 'EP', day: 1, min: 1, tid: 'EP1', key: 'k', payload: { event: 'payment.completed', txn_id: 'EP12345678', amount_pkr: '50' } })).toThrow();
  });
});
