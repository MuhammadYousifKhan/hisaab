'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

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
