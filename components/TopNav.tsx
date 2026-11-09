'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const VIEWS = [
  { href: '/borrower/B01', match: '/borrower', label: 'Borrower app' },
  { href: '/console', match: '/console', label: 'Lender console' },
  { href: '/proof', match: '/proof', label: 'Proof' },
  { href: '/blueprint', match: '/blueprint', label: 'Blueprint' },
];

export default function TopNav() {
  const path = usePathname() || '/';
  return (
    <nav className="views" aria-label="Views">
      {VIEWS.map(v => (
        <Link key={v.href} href={v.href} aria-current={path.startsWith(v.match) ? 'page' : undefined}>
          {v.label}
        </Link>
      ))}
    </nav>
  );
}
