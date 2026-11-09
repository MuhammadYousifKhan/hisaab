'use client';
import { useRouter } from 'next/navigation';

export default function PersonaSelect({ current, options, lang }: { current: string; options: { id: string; label: string }[]; lang: string }) {
  const router = useRouter();
  return (
    <div className="viewing">
      <label htmlFor="persona-sel">Viewing as</label>
      <select id="persona-sel" value={current} onChange={e => router.push('/borrower/' + e.target.value + (lang === 'ur' ? '?lang=ur' : ''))}>
        {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  );
}
