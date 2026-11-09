import type { Lang } from './types';

// Day 0 is 1 Sep 2026. "Today" in the scenario is day 69, 9 Nov 2026.
export const DAY0 = Date.UTC(2026, 8, 1);
export const TODAY = 69;
const MS = 86400000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_UR = ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const dt = (d: number) => new Date(DAY0 + d * MS);

export function fmtDate(d: number, lang: Lang = 'en', year = false): string {
  const x = dt(d), m = x.getUTCMonth(), dd = x.getUTCDate();
  const y = year ? ' ' + x.getUTCFullYear() : '';
  return lang === 'ur' ? dd + ' ' + MON_UR[m] + y : dd + ' ' + MON[m] + y;
}
export const dayName = (d: number) => WD[dt(d).getUTCDay()];
export const iso = (d: number) => dt(d).toISOString().slice(0, 10);
export const hhmm = (m: number) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
export const stamp = (day: number, min: number) => iso(day) + 'T' + hhmm(min) + ':00+05:00';

export function fmtRs(p: number, lang: Lang = 'en'): string {
  const neg = p < 0, v = Math.abs(p), r = Math.floor(v / 100), ps = v % 100;
  let s = r.toLocaleString('en-US');
  if (ps) s += '.' + String(ps).padStart(2, '0');
  const sign = neg ? '−' : '';
  return lang === 'ur' ? sign + s + ' روپے' : sign + 'Rs ' + s;
}
/** The number part only, e.g. "5,000" or "−5,000". */
export const fmtNum = (p: number) => fmtRs(p, 'en').replace('Rs ', '');

/** Parse "5000.00" into paisa without floating point. */
export function toPaisa(s: string): number {
  const parts = String(s).split('.');
  return parseInt(parts[0], 10) * 100 + parseInt(((parts[1] || '') + '00').slice(0, 2), 10);
}
export const amtStr = (p: number) => Math.floor(p / 100) + '.' + String(p % 100).padStart(2, '0');

export const maskPhone = (p: string | null | undefined) => (p ? p.slice(0, 4) + '-•••' + p.slice(-4) : '—');
/** Isolate a left-to-right fragment (phone, reference) inside an Urdu sentence. */
export const LTR = (s: string) => '⁦' + s + '⁩';

/** Deterministic PRNG so the same seed always produces the same scenario. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
