import type { Lang } from './types';

// Day 0 is 1 Sep 2026. Days and minutes are counted in Pakistan time (UTC+5, no daylight saving).
// The demo scenario is frozen at day 69, 9 Nov 2026; live books follow the real clock.
export const DAY0 = Date.UTC(2026, 8, 1);
export const DEMO_TODAY = 69;
const MS = 86400000;
const PKT = 5 * 3600000;

/** Day number and minute of the day in Pakistan time for a moment (default: now). */
export function pktAt(ms: number = Date.now()): { day: number; min: number } {
  const t = ms + PKT - DAY0;
  const day = Math.floor(t / MS);
  return { day, min: Math.floor((t - day * MS) / 60000) };
}
export const pktNow = () => pktAt(Date.now());
/**
 * Parse a timestamp such as 2026-11-09T19:40:00+05:00 into a Pakistan-time day and minute.
 * Timestamps without a zone ("2026-11-09 14:30", "2026-11-09") are Pakistan time, never the server's zone.
 */
export function parseStamp(s: unknown): { day: number; min: number } | null {
  if (typeof s !== 'string' || !s.trim()) return null;
  let t = s.trim();
  const local = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(t);
  if (local) t = local[1] + 'T' + (local[2] ?? '00').padStart(2, '0') + ':' + (local[3] ?? '00') + ':' + (local[4] ?? '00') + '+05:00';
  else if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(t)) return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? pktAt(ms) : null;
}
/** "2026-11-09" to a day number, or null. */
export function dayFromIso(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(ms);
  if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return Math.round((ms - DAY0) / MS);
}
/** "HH:MM" to minutes after midnight, or null. */
export function minFromHhmm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(s).trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
}
/** Pakistani mobile numbers in any common form (+92 300…, 92300…, 0300-…) become 03XXXXXXXXX. */
export function normPhone(p: string | null | undefined): string {
  let d = String(p ?? '').replace(/[^\d]/g, '');
  if (d.startsWith('0092')) d = d.slice(2);
  if (d.startsWith('92') && d.length === 12) d = '0' + d.slice(2);
  if (d.length === 10 && d.startsWith('3')) d = '0' + d;
  return d;
}
export const isMobile = (p: string) => /^03\d{9}$/.test(p);
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
