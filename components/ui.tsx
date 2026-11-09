import type { ReactNode } from 'react';
import { fmtNum, fmtRs } from '@/lib/engine/util';
import type { Lang } from '@/lib/engine/types';

export function Pill({ cls, icon, children }: { cls: string; icon: string; children: ReactNode }) {
  return <span className={'pill ' + cls}><i aria-hidden="true">{icon}</i>{children}</span>;
}

/** Money for borrowers: the number is isolated left-to-right and the unit sits where the language puts it. */
export function Money({ v, lang = 'en' }: { v: number; lang?: Lang }) {
  if (lang === 'ur') return <><span className="num">{fmtNum(v)}</span> روپے</>;
  return <span className="num">Rs {fmtNum(v)}</span>;
}
/** Money in the English console. */
export function Rs({ v }: { v: number }) {
  return <span className="num">{fmtRs(v)}</span>;
}

const AUD: Record<'borrower' | 'console' | 'proof', ReactNode> = {
  borrower: <><b>Built for borrowers with thin or no credit files:</b> rickshaw and bike riders, home tailors, shopkeepers, students. They pay by JazzCash, Easypaisa, Raast or a cash agent, sometimes from a relative’s phone. Pick a person to see their problem; switch language inside the phone.</>,
  console: <><b>For the lender’s operations team,</b> who check every channel against the bank each morning. Actual figures come only from the ledger. The projection panel is kept apart and never added to them.</>,
  proof: <><b>For the judges.</b> The HS-0302 success criteria, recomputed live on synthetic data: ledger consistency, traceability, and correct handling of exceptional payment states. Checked in the engine and again in Postgres.</>,
};
export function Audience({ kind }: { kind: keyof typeof AUD }) {
  return <div className="aud"><span className="aud-k">Who this is for</span><p>{AUD[kind]}</p></div>;
}

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return <dl className="facts">{items.map(([k, v]) => <FactRow key={k} k={k} v={v} />)}</dl>;
}
function FactRow({ k, v }: { k: string; v: ReactNode }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}
