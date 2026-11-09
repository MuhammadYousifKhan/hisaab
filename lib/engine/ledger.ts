// P1 · Ledger: double-entry, append-only, integer paisa. post() refuses anything that does not balance.
import { ACCTS } from './data';
import type { AcctCode, Entry, Ledger, PostInput } from './types';
import { fmtRs } from './util';

export function makeLedger(): Ledger {
  const entries: Entry[] = [];
  const bal = new Map<string, number>();
  let seq = 0;

  function post(o: PostInput): Entry {
    let dr = 0, cr = 0;
    for (const l of o.lines) {
      const a = l.dr || 0, c = l.cr || 0;
      if (!Number.isInteger(a) || !Number.isInteger(c) || a < 0 || c < 0) throw new Error('Rejected: amounts must be whole, positive paisa');
      if (!ACCTS[l.acct]) throw new Error('Rejected: unknown account ' + l.acct);
      dr += a; cr += c;
    }
    if (dr !== cr) throw new Error('Rejected: debits ' + fmtRs(dr) + ' do not equal credits ' + fmtRs(cr) + '. Nothing was written.');
    if (dr === 0) throw new Error('Rejected: empty entry');
    if (!o.reason) throw new Error('Rejected: missing reason code');
    const e: Entry = {
      id: 'JE-' + String(++seq).padStart(4, '0'), day: o.day, reason: o.reason, params: o.params || {},
      lines: o.lines.filter(l => (l.dr || 0) + (l.cr || 0) > 0).map(l => ({ acct: l.acct, sub: l.sub || null, dr: l.dr || 0, cr: l.cr || 0 })),
      src: o.src || [], actor: o.actor || 'system', total: dr, reverses: o.reverses || null, reversedBy: null,
    };
    entries.push(e);
    for (const l of e.lines) {
      const k = l.acct + '|' + (l.sub || '');
      bal.set(k, (bal.get(k) || 0) + l.dr - l.cr);
    }
    return e;
  }

  /** Debit-positive balance. With `sub`, one borrower's sub-ledger; without, the whole account. */
  function balance(acct: AcctCode, sub?: string | null): number {
    if (sub !== undefined) return bal.get(acct + '|' + (sub || '')) || 0;
    let s = 0;
    for (const [k, v] of bal) if (k.startsWith(acct + '|')) s += v;
    return s;
  }

  return { entries, bal, post, balance };
}
