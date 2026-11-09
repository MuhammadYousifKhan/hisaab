'use client';
// Settled bank receipts per day (actual), then a hatched projection range. One scale, one axis.
import { useEffect, useRef, useState } from 'react';
import { dayName, fmtDate, fmtRs } from '@/lib/engine/util';

interface Props { past: { day: number; v: number }[]; fc: { day: number; low: number; high: number }[]; today: number }

function niceStep(raw: number) {
  if (raw <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
const compact = (v: number) => { const rs = v / 100; return rs >= 1000 ? 'Rs ' + Math.round(rs / 100) / 10 + 'K' : 'Rs ' + Math.round(rs); };
const f1 = (v: number) => Math.round(v * 10) / 10;

export default function CollectionsChart({ past, fc, today: TODAY }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  const [hot, setHot] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setW(Math.max(280, Math.floor(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const Hh = 230, L = 58, Rp = 10, Tp = 22, B = 28;
  const n = past.length + fc.length;
  const maxV = Math.max(1, ...past.map(p => p.v), ...fc.map(f => f.high));
  const stp = niceStep(maxV / 4), yMax = Math.ceil(maxV / stp) * stp;
  const iw = W - L - Rp, ih = Hh - Tp - B, band = iw / n, bw = Math.max(3, Math.min(14, band * 0.64));
  const x = (i: number) => L + band * i + band / 2;
  const y = (v: number) => Tp + ih - (v / yMax) * ih;
  const ticks: number[] = [];
  for (let v = 0; v <= yMax; v += stp) ticks.push(v);
  const tx = L + band * past.length;
  const every = W < 560 ? 14 : 7;
  const dayAt = (i: number) => (i < past.length ? past[i].day : fc[i - past.length].day);
  const tip = hot === null ? null : hot < past.length
    ? { text: dayName(past[hot].day) + ' ' + fmtDate(past[hot].day) + ' · reached bank: ' + fmtRs(past[hot].v), top: y(past[hot].v) }
    : { text: dayName(fc[hot - past.length].day) + ' ' + fmtDate(fc[hot - past.length].day) + ' · expected: ' + fmtRs(fc[hot - past.length].low) + ' – ' + fmtRs(fc[hot - past.length].high) + ' (projection)', top: y(fc[hot - past.length].high) };

  return (
    <div className="chart" ref={box}>
      <svg width={W} height={Hh} viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label="Money settled in the bank for each of the last 30 days, then a hatched projection range of expected payments for the next 14 days."
        onPointerMove={e => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.floor((e.clientX - r.left - L) / band);
          setHot(i >= 0 && i < n ? i : null);
        }}
        onPointerLeave={() => setHot(null)}>
        <defs>
          <pattern id="ph" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" className="ph-bg" />
            <line x1="0" y1="0" x2="0" y2="5" className="ph-line" />
          </pattern>
        </defs>
        {ticks.map(v => (
          <g key={v}>
            <line x1={L} x2={W - Rp} y1={f1(y(v))} y2={f1(y(v))} className={v === 0 ? 'c-axis' : 'c-grid-line'} />
            <text x={L - 8} y={f1(y(v) + 4)} textAnchor="end" className="c-tick">{compact(v)}</text>
          </g>
        ))}
        {hot !== null && <rect x={f1(L + band * hot)} y={Tp} width={f1(band)} height={ih} className="c-hot" />}
        {past.map((p, i) => {
          if (!p.v) return null;
          const top = y(p.v), bot = y(0), x0 = x(i) - bw / 2, x1 = x(i) + bw / 2, r = Math.min(3, bw / 2, bot - top);
          return <path key={p.day} className="c-bar" d={`M${f1(x0)},${f1(bot)} V${f1(top + r)} Q${f1(x0)},${f1(top)} ${f1(x0 + r)},${f1(top)} H${f1(x1 - r)} Q${f1(x1)},${f1(top)} ${f1(x1)},${f1(top + r)} V${f1(bot)} Z`} />;
        })}
        {fc.map((f, k) => {
          if (!f.high) return null;
          const i = past.length + k, top = y(f.high), bot = Math.max(y(f.low), top + 2);
          return <rect key={f.day} x={f1(x(i) - bw / 2)} y={f1(top)} width={f1(bw)} height={f1(bot - top)} rx="2" fill="url(#ph)" className="c-proj" />;
        })}
        <line x1={f1(tx)} x2={f1(tx)} y1={Tp - 14} y2={Tp + ih} className="c-today" />
        <text x={f1(tx - 6)} y={Tp - 6} textAnchor="end" className="c-today-t">Actual</text>
        <text x={f1(tx + 6)} y={Tp - 6} className="c-today-t">Projection</text>
        {Array.from({ length: n }, (_, i) => i).filter(i => (dayAt(i) - TODAY) % every === 0).map(i => (
          <text key={i} x={f1(x(i))} y={Hh - 8} textAnchor="middle" className="c-tick">{dayAt(i) === TODAY ? 'Today' : fmtDate(dayAt(i))}</text>
        ))}
      </svg>
      {tip && <div className="tip" style={{ left: Math.min(Math.max(x(hot!), 110), W - 110), top: Math.max(tip.top, Tp) }}>{tip.text}</div>}
    </div>
  );
}
