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

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return <dl className="facts">{items.map(([k, v]) => <FactRow key={k} k={k} v={v} />)}</dl>;
}
function FactRow({ k, v }: { k: string; v: ReactNode }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}
