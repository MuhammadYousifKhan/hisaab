'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { switchBook } from '@/app/login/actions';

export interface NavItem { href: string; match: string; label: string }

export default function TopNav({ items }: { items: NavItem[] }) {
  const path = usePathname() || '/';
  return (
    <nav className="views" aria-label="Views">
      {items.map(v => (
        <Link key={v.href} href={v.href} aria-current={(v.match === '/' ? path === '/' : path.startsWith(v.match)) ? 'page' : undefined}>
          {v.label}
        </Link>
      ))}
    </nav>
  );
}

/** Live or demo book. The form posts the current address so the switch returns to the same screen. */
export function BookSwitch({ kind }: { kind: 'live' | 'demo' }) {
  const path = usePathname() || '/';
  const sp = useSearchParams();
  const next = path + (sp.size ? '?' + sp.toString() : '');
  return (
    <form action={switchBook} className="seg book-seg" aria-label="Which book">
      <input type="hidden" name="next" value={next} />
      <button type="submit" name="kind" value="live" aria-pressed={kind === 'live'}>Live</button>
      <button type="submit" name="kind" value="demo" aria-pressed={kind === 'demo'}>Demo</button>
    </form>
  );
}
