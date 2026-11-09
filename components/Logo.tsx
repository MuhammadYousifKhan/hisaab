/** The Hisaab mark: three payment channels merging into one confirmed tick. Follows the light and dark themes. */
export default function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false" className={className}>
      <rect width="64" height="64" rx="15" fill="var(--accent)" />
      <g fill="none" stroke="var(--accent-ink)" strokeWidth="5.6" strokeLinecap="round">
        <path d="M11 17.5c11.5 0 12.5 14.5 22 14.5" />
        <path d="M11 32h22" />
        <path d="M11 46.5c11.5 0 12.5-14.5 22-14.5" />
      </g>
      <circle cx="43.5" cy="32" r="11" fill="var(--accent-ink)" />
      <path d="M38.6 32.4l3.5 3.5 6.4-7.6" fill="none" stroke="var(--accent)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
