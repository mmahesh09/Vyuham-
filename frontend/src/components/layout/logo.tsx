import Link from "next/link";
import { useId } from "react";

import { LOGO_PIECES, LOGO_VIEW_BOX } from "@/components/layout/logo-shapes";

/**
 * Vyuham mark: three pieces forming around an open centre. Vyuham means a formation, an arrangement:
 * scattered data lined up around the one answer that matters.
 */
export function LogoMark({ className = "size-8" }: { className?: string }) {
  const id = useId(); // several logos can share a page, so gradient ids must be unique
  return (
    <svg viewBox={LOGO_VIEW_BOX} className={className} aria-hidden>
      <defs>
        {LOGO_PIECES.map((piece) => (
          <linearGradient
            key={piece.key}
            id={`vy-${piece.key}-${id}`}
            gradientUnits="userSpaceOnUse"
            x1={piece.from[0]}
            y1={piece.from[1]}
            x2={piece.to[0]}
            y2={piece.to[1]}
          >
            {piece.stops.map(([offset, color]) => (
              <stop key={offset} offset={offset} stopColor={color} />
            ))}
          </linearGradient>
        ))}
      </defs>
      {LOGO_PIECES.map((piece) => (
        <path key={piece.key} d={piece.d} fill={`url(#vy-${piece.key}-${id})`} />
      ))}
    </svg>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} aria-label="Vyuham home" className="flex items-center gap-2.5 px-2.5 text-text no-underline">
      <LogoMark />
      <span className="font-display text-[19px] font-semibold tracking-[-0.03em]">Vyuham</span>
    </Link>
  );
}
