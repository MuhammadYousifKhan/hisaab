import { describe, expect, it } from 'vitest';
import { hashSecret, verifySecret } from '@/lib/auth/password';
import { expiresIn, signSession, verifySession } from '@/lib/auth/session';
import { agentRows, bankLinesFrom, bankRowsFromCsv, creditPaisa } from '@/lib/ingest/files';
import { csvRecords, parseCsv } from '@/lib/ingest/csv';
import { describePayload, paymentPayload } from '@/lib/ingest/payloads';
import { checkPayload } from '@/lib/ingest/ingest';
import { dayFromIso, normPhone, parseStamp, iso } from '@/lib/engine';

describe('csv', () => {
  it('handles quotes, commas, CRLF, BOM and blank lines', () => {
    const t = '﻿Name,Note\r\n"Khan, Ali","said ""hi"""\r\n\r\nSara,"two\nlines"\r\n';
    expect(parseCsv(t)).toEqual([['Name', 'Note'], ['Khan, Ali', 'said "hi"'], ['Sara', 'two\nlines']]);
    expect(csvRecords('A B,c\n1,2').header).toEqual(['a_b', 'c']);
  });
});

describe('uploaded files', () => {
  it('agent rows keep their values as received and require key columns', () => {
    const ok = agentRows('receipt_no,agent_id,customer_ref,customer_name,amount,status,collected_at\nCA100001,AG-1,L001,ALI,2000,collected,2026-11-09 11:05');
    expect(ok.errors).toEqual([]);
    expect(ok.payloads[0]).toMatchObject({ receipt_no: 'CA100001', status: 'collected' });
    expect(checkPayload({ ch: 'CA', payload: ok.payloads[0] })).toBeNull();
    expect(agentRows('a,b\n1,2').errors[0].error).toMatch(/Missing columns: receipt_no, amount, status/);
  });

  it('bank lines: credits only, forgiving amounts, and the same file twice gets the same keys', () => {
    const csv = 'date,time,amount,narration,ref\n2026-11-09,09:12,"1,975.00",EASYPAISA SETTLEMENT,EP-SETL-2026-11-08\n2026-11-09,,500,CASH DEPOSIT,\n2026-11-09,,500,CASH DEPOSIT,\n2026-11-09,,-20,FEE,\nnot a date,,5,x,\n';
    const parsed = bankRowsFromCsv(csv);
    const a = bankLinesFrom(parsed.rows, 'test'), b = bankLinesFrom(parsed.rows, 'test');
    expect(a.lines.map(l => l.amount)).toEqual([197500, 50000, 50000]);
    expect(a.errors.map(e => e.line)).toEqual([5, 6]);
    expect(a.lines.map(l => l.key)).toEqual(b.lines.map(l => l.key));
    expect(new Set(a.lines.map(l => l.key)).size).toBe(3); // two equal deposits are two lines
    expect(bankRowsFromCsv('x,y\n1,2').errors[0].error).toMatch(/Missing columns: date, amount/);
  });

  it('amount parsing', () => {
    expect(creditPaisa('Rs 3,500.50')).toBe(350050);
    expect(creditPaisa('0')).toBeNull();
    expect(creditPaisa('12.345')).toBeNull();
    expect(creditPaisa('-5')).toBeNull();
  });
});

describe('payloads', () => {
  const recv = { day: 70, min: 600 };
  it('builds an idempotency key from channel, transaction and status', () => {
    const p = paymentPayload({ ch: 'JC', tid: 'JC12345678', amount: 100000, phone: '03001112223', name: 'A', ref: '', status: 'success', day: 70, min: 500 });
    expect(describePayload('JC', p, recv)).toMatchObject({ key: 'JC:JC12345678:success', tid: 'JC12345678', day: 70, min: 500 });
    expect(describePayload('JC', { ...p, type: 'TXN_PENDING' }, recv).key).toBe('JC:JC12345678:pending');
  });
  it('a broken payload still gets a stable key, and a future timestamp falls back to arrival time', () => {
    const k1 = describePayload('EP', { foo: 1 }, recv), k2 = describePayload('EP', { foo: 1 }, recv);
    expect(k1.key).toBe(k2.key);
    expect(k1.status).toBe('invalid');
    const future = paymentPayload({ ch: 'EP', tid: 'EP12345678', amount: 100, phone: null, name: '', ref: '', status: 'success', day: 99, min: 0 });
    expect(describePayload('EP', future, recv)).toMatchObject({ day: 70, min: 600 });
  });
  it('validation names the offending field', () => {
    expect(checkPayload({ ch: 'EP', payload: { event: 'payment.completed', txn_id: 'EP12345678', amount_pkr: 'lots' } })).toMatch(/amount_pkr/);
    expect(checkPayload({ ch: 'EP', payload: paymentPayload({ ch: 'EP', tid: 'EP12345678', amount: 5000, phone: null, name: 'A', ref: '', status: 'success', day: 70, min: 1 }) })).toBeNull();
  });
});

describe('dates and phones', () => {
  it('reads zone-less timestamps as Pakistan time', () => {
    expect(parseStamp('2026-11-09 14:30')).toEqual({ day: dayFromIso('2026-11-09'), min: 14 * 60 + 30 });
    expect(parseStamp('2026-11-09T14:30:00+05:00')).toEqual(parseStamp('2026-11-09 14:30'));
    expect(parseStamp('2026-11-09T09:30:00Z')).toEqual({ day: dayFromIso('2026-11-09'), min: 14 * 60 + 30 });
    expect(parseStamp('garbage')).toBeNull();
    expect(iso(dayFromIso('2026-02-30') ?? 0)).toBe(iso(0)); // invalid dates are rejected
    expect(dayFromIso('2026-02-30')).toBeNull();
  });
  it('normalises phone numbers', () => {
    for (const p of ['0300 1234567', '+92 300 1234567', '92-300-1234567', '3001234567', '0092 300 1234567']) expect(normPhone(p)).toBe('03001234567');
  });
});

describe('sessions and passwords', () => {
  const secret = 'test-secret';
  const staff = { role: 'ops' as const, staffId: 1, username: 'sana', name: 'Sana', exp: expiresIn(1) };
  it('accepts its own tokens', () => {
    expect(verifySession(signSession(staff, secret), secret)).toEqual(staff);
  });
  it('rejects tampered, wrong-key and expired tokens', () => {
    const t = signSession(staff, secret);
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...staff, role: 'ops', staffId: 2 })).toString('base64url');
    expect(verifySession(forged + '.' + sig, secret)).toBeNull();
    expect(verifySession(body + '.' + sig.slice(0, -2) + 'AA', secret)).toBeNull();
    expect(verifySession(t, 'other-secret')).toBeNull();
    expect(verifySession(t, secret, staff.exp + 1)).toBeNull();
    expect(verifySession('', secret)).toBeNull();
    expect(verifySession('nodot', secret)).toBeNull();
    expect(verifySession(signSession({ ...staff, exp: Date.now() - 1 }, secret), secret)).toBeNull();
  });
  it('a borrower token cannot be turned into a staff one', () => {
    const b = signSession({ role: 'borrower', bookId: 1, bid: 'B001', name: 'A', exp: expiresIn(1) }, secret);
    const s = verifySession(b, secret);
    expect(s?.role).toBe('borrower');
  });
  it('hashes with a fresh salt and verifies', async () => {
    const h1 = await hashSecret('4321'), h2 = await hashSecret('4321');
    expect(h1).not.toBe(h2);
    expect(await verifySecret('4321', h1)).toBe(true);
    expect(await verifySecret('4322', h1)).toBe(false);
    expect(await verifySecret('4321', 'garbage')).toBe(false);
  });
});
