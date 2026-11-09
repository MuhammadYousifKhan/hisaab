import { Fragment, type ReactNode } from 'react';
import { T, type StrKey } from '@/lib/content/strings';
import type { Lang } from '@/lib/engine/types';

export { CITY_UR } from '@/lib/content/strings';
export type { StrKey };

/** Plain-text string with {placeholders} filled in. */
export function ts(lang: Lang, key: StrKey, params?: Record<string, string | number>): string {
  let s: string = (T[lang] as Record<StrKey, string>)[key] ?? T.en[key];
  if (params) s = s.replace(/\{(\w+)\}/g, (m, x) => (params[x] !== undefined ? String(params[x]) : m));
  return s;
}

/** String with {placeholders} that may be React nodes (money, dates in spans). */
export function tr(lang: Lang, key: StrKey, params?: Record<string, ReactNode>): ReactNode {
  const s: string = (T[lang] as Record<StrKey, string>)[key] ?? T.en[key];
  if (!params) return s;
  const parts = s.split(/\{(\w+)\}/);
  return parts.map((p, i) => <Fragment key={i}>{i % 2 ? (params[p] ?? '{' + p + '}') : p}</Fragment>);
}

export const parseLang = (v: unknown): Lang => (v === 'ur' ? 'ur' : 'en');
