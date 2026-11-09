'use client';
import { useActionState, useState } from 'react';
import { reportPayment, type ReportState } from '@/app/actions';

export interface ReportStrings {
  fCh: string; fAmt: string; fDate: string; fTid: string; fTidHint: string; fSend: string;
  eTid: string; eAmt: string; eOther: string; sent: string; sending: string;
}
interface Props {
  bid: string; bookId: number; strings: ReportStrings;
  channels: { v: string; label: string }[]; days: { v: number; label: string }[];
}

export default function ReportForm({ bid, bookId, strings: s, channels, days }: Props) {
  const [state, action, pending] = useActionState<ReportState, FormData>(reportPayment, {});
  const [ch, setCh] = useState(channels[0].v);
  const [amt, setAmt] = useState('');
  const [day, setDay] = useState(String(days[0].v));
  const [tid, setTid] = useState('');
  const err = state.error ? s[state.error] : null;
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="bid" value={bid} />
      <input type="hidden" name="bookId" value={bookId} />
      <div className="field">
        <label htmlFor="f-ch">{s.fCh}</label>
        <select id="f-ch" name="ch" value={ch} onChange={e => setCh(e.target.value)}>
          {channels.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="f-amt">{s.fAmt}</label>
        <input id="f-amt" name="amt" inputMode="decimal" autoComplete="off" dir="ltr" value={amt} onChange={e => setAmt(e.target.value)} aria-invalid={state.error === 'eAmt'} />
      </div>
      <div className="field">
        <label htmlFor="f-day">{s.fDate}</label>
        <select id="f-day" name="day" value={day} onChange={e => setDay(e.target.value)}>
          {days.map(d => <option key={d.v} value={d.v}>{d.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="f-tid">{s.fTid}</label>
        <input id="f-tid" name="tid" autoComplete="off" autoCapitalize="characters" spellCheck={false} dir="ltr" value={tid} onChange={e => setTid(e.target.value)} aria-invalid={state.error === 'eTid'} />
        <span className="hint">{s.fTidHint}</span>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      {state.ok && !pending && <p className="msg good" role="status">{s.sent}</p>}
      <button type="submit" className="btn full" disabled={pending}>{pending ? s.sending : s.fSend}</button>
    </form>
  );
}
