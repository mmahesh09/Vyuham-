import Link from "next/link";
import { useId } from "react";

/**
 * Vyuham mark: a "V" of two strokes closing around a single point. Vyuham means a formation,
 * an arrangement: scattered data lined up around the one answer that matters.
 * The same drawing is the favicon (src/app/icon.svg).
 */
export function LogoMark({ className = "size-8" }: { className?: string }) {
  const tile = `vy-tile-${useId()}`; // unique per instance: several logos can share a page
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id={tile} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#806bcc" />
          <stop offset="1" stopColor="#5b49a3" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${tile})`} />
      <path d="M8.5 9.5 16 23" stroke="#f5f2ff" strokeOpacity="0.55" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M16 23 23.5 9.5" stroke="#f5f2ff" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="16" cy="9.5" r="2" fill="#f0b8f2" />
    </svg>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} aria-label="Vyuham home" className="flex items-center gap-2.5 px-2.5 text-text no-underline">
      <LogoMark />
      <span className="font-display text-[19px] font-semibold lowercase tracking-[-0.03em]">vyuham</span>
    </Link>
  );
}
