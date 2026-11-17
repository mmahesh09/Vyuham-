import type { CSSProperties, ReactNode } from "react";

/*
 * Integration Grid – a card illustration, in a single self-contained file.
 * A honeycomb-like wall of rounded logo tiles in three rows (7 · 9 · 7). The middle row reaches one
 * tile further on each side; its centre tile is larger, pure white and holds your product mark.
 * The other tiles are frosted and fade out toward the edges, while the logos stay at full color.
 * The artwork is laid out on a 1520 × 560 grid (with 9 columns) and scales with its container.
 *
 * Vyuham changes: no "use client" (nothing here is interactive; hover is CSS), so it renders on the server
 * with no JavaScript; and `logos` is required (the homepage passes components/marketing/integration-logos.ts).
 */

export type IntegrationGridLogo = {
  /** Name for the accessible description */
  name: string;
  /** A single SVG path on a 24 × 24 viewBox (e.g. from simple-icons) */
  path: string;
  /** Fill color – leave it out for black marks that should follow the ink color (and turn light in dark mode) */
  color?: string;
  /** Optional fill color in dark mode, for brand colors that are too dark on a dark tile */
  darkColor?: string;
};

export type IntegrationGridProps = {
  /** Up to 22 logos, filled row by row around the centre tile */
  logos: IntegrationGridLogo[];
  /** Content of the centre tile – defaults to a neutral product mark */
  mark?: ReactNode;
  /** Tiles in the middle row – 9 by default; the rows above and below get two fewer. Use 7 or 5 for a tighter grid */
  columns?: 5 | 7 | 9;
  className?: string;
  /** Accessible description of the scene */
  label?: string;
};

/* Layout (in grid units): tile 140, gap 20, centre tile 168 – 80 units of air around the outer tiles */
const STEP = 160;
const MID_Y = 280;

type Slot = { x: number; y: number; center: boolean; d: number };

/** Width of the layout for a number of columns: 9 columns → 1520 units */
const widthFor = (columns: number) => columns * STEP + 80;

function slotsFor(columns: number): Slot[] {
  const midX = widthFor(columns) / 2;
  return [columns - 2, columns, columns - 2].flatMap((count, row) =>
    Array.from({ length: count }, (_, i) => {
      const x = midX + (i - (count - 1) / 2) * STEP;
      const y = MID_Y + (row - 1) * STEP;
      const d = Math.hypot((x - midX) / STEP, (y - MID_Y) / STEP);
      return { x, y, center: row === 1 && i === (count - 1) / 2, d };
    }),
  );
}

export function IntegrationGrid({ logos, mark, columns = 9, className, label }: IntegrationGridProps) {
  const list = logos;
  const SLOTS = slotsFor(columns);
  const outer = SLOTS.filter((s) => !s.center).length;
  const shown = list.slice(0, outer);
  let n = 0;

  return (
    <div
      className={["ui-ig", className].filter(Boolean).join(" ")}
      style={columns === 9 ? undefined : ({ "--ui-ig-w": widthFor(columns) } as CSSProperties)}
      role="img"
      aria-label={label ?? `Integrates with ${shown.map((l) => l.name).join(", ")}`}
    >
      {/* React 19 hoists this into <head> once, no matter how many instances render */}
      <style href="ui-integration-grid" precedence="default">
        {css}
      </style>

      {SLOTS.map((s, i) => {
        if (s.center) {
          return (
            <span key={i} className="ui-ig-tile ui-ig-tile--center" style={{ "--x": s.x, "--y": s.y } as CSSProperties} aria-hidden="true">
              {mark ?? <ProductMark />}
            </span>
          );
        }
        // Logos repeat if fewer than the number of tiles are passed
        const logo = list[n++ % list.length];
        // Fill fades from ~55% next to the centre to ~25% at the far edges; border and shadow follow
        const fill = Math.max(0.22, 0.64 - 0.095 * s.d);
        const k = Math.max(0.35, 1 - 0.16 * s.d);
        return (
          <span
            key={i}
            className="ui-ig-tile"
            style={
              {
                "--x": s.x,
                "--y": s.y,
                "--ui-ig-a": fill.toFixed(3),
                "--ui-ig-k": k.toFixed(3),
                ...(logo.color ? { "--ui-ig-c": logo.color } : null),
                ...(logo.darkColor ? { "--ui-ig-cd": logo.darkColor } : null),
              } as CSSProperties
            }
            aria-hidden="true"
          >
            <svg className="ui-ig-logo" viewBox="0 0 24 24" aria-hidden="true">
              <path d={logo.path} />
            </svg>
          </span>
        );
      })}
    </div>
  );
}

/* A neutral four-petal flower in the ink color, with fainter diagonal petals */
function ProductMark() {
  const petal = "M24 24C17.6 19.6 16.4 9.4 24 3.5C31.6 9.4 30.4 19.6 24 24Z";
  return (
    <svg className="ui-ig-mark" viewBox="0 0 48 48" aria-hidden="true">
      <g className="ui-ig-mark-soft">
        {[45, 135, 225, 315].map((r) => (
          <path key={r} d={petal} transform={`rotate(${r} 24 24)`} />
        ))}
      </g>
      {[0, 90, 180, 270].map((r) => (
        <path key={r} d={petal} transform={`rotate(${r} 24 24)`} />
      ))}
      <circle className="ui-ig-mark-core" cx="24" cy="24" r="3.4" />
    </svg>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
.ui-ig {
  /* 1 unit of the layout grid – 1520 × 560 with 9 columns, narrower with fewer */
  --u: calc(100cqw / var(--ui-ig-w, 1520));
  --ui-ig-ink: #0a0a0a;
  /* Tile fill as RGB channels, so each tile can set its own opacity */
  --ui-ig-tile: 255 255 255;
  --ui-ig-border: 0 0 0;
  --ui-ig-border-a: 0.15;
  --ui-ig-shadow-a: 1;
  --ui-ig-center: #ffffff;
  --ui-ig-center-border: rgba(0, 0, 0, 0.14);
  --ui-ig-center-shadow: 0 calc(16 * var(--u)) calc(18 * var(--u)) calc(-12 * var(--u)) rgba(0, 0, 0, 0.14);
  --ui-ig-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  width: 100%;
  aspect-ratio: var(--ui-ig-w, 1520) / 560;
  container-type: inline-size;
}
.ui-ig *, .ui-ig *::before, .ui-ig *::after { box-sizing: border-box; }

/* ---------- Tiles ---------- */

.ui-ig-tile {
  --s: 140;
  position: absolute;
  left: calc((var(--x) - var(--s) / 2) * var(--u));
  top: calc((var(--y) - var(--s) / 2) * var(--u));
  width: calc(var(--s) * var(--u));
  height: calc(var(--s) * var(--u));
  display: grid;
  place-items: center;
  border-radius: calc(22 * var(--u));
  background: rgb(var(--ui-ig-tile) / var(--ui-ig-a));
  box-shadow:
    inset 0 0 0 calc(1 * var(--u)) rgb(var(--ui-ig-border) / calc(var(--ui-ig-border-a) * (0.7 + 0.3 * var(--ui-ig-k)))),
    /* Only below the tile: a negative spread keeps it from showing left, right and above */
    0 calc(12 * var(--u)) calc(14 * var(--u)) calc(-10 * var(--u)) rgb(0 0 0 / calc(0.06 * (0.65 + 0.35 * var(--ui-ig-k)) * var(--ui-ig-shadow-a)));
  transition: transform 0.35s var(--ui-ig-ease), background-color 0.35s var(--ui-ig-ease), box-shadow 0.35s var(--ui-ig-ease);
}
/* Hover: the tile stays put and turns fully white, its logo grows a little from the centre */
.ui-ig-tile:not(.ui-ig-tile--center):hover { --ui-ig-a: 1; }
.ui-ig-tile:hover .ui-ig-logo { transform: scale(1.18); }

.ui-ig-logo {
  width: calc(52 * var(--u));
  height: calc(52 * var(--u));
  fill: var(--ui-ig-c, var(--ui-ig-ink));
  transition: transform 0.35s var(--ui-ig-ease);
}

/* The centre: larger, pure white, a stronger shadow and the product mark */
.ui-ig-tile--center {
  --s: 168;
  z-index: 1;
  border-radius: calc(28 * var(--u));
  background: var(--ui-ig-center);
  box-shadow: inset 0 0 0 calc(1 * var(--u)) var(--ui-ig-center-border), var(--ui-ig-center-shadow);
  color: var(--ui-ig-ink);
}
.ui-ig-mark {
  width: calc(68 * var(--u));
  height: calc(68 * var(--u));
  fill: var(--ui-ig-ink);
}
.ui-ig-mark-soft { opacity: 0.32; }
.ui-ig-mark-core { fill: var(--ui-ig-center); }

@media (prefers-reduced-motion: reduce) {
  .ui-ig-tile { transition: none; }
  .ui-ig-logo { transition: none; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-ig {
  --ui-ig-ink: #ededed;
  --ui-ig-tile: 35 35 38;
  --ui-ig-border: 255 255 255;
  --ui-ig-border-a: 0.1;
  --ui-ig-shadow-a: 4;
  --ui-ig-center: #2a2a2d;
  --ui-ig-center-border: rgba(255, 255, 255, 0.16);
  --ui-ig-center-shadow: 0 calc(16 * var(--u)) calc(18 * var(--u)) calc(-12 * var(--u)) rgba(0, 0, 0, 0.5);
}
:where(.dark, [data-theme="dark"]) .ui-ig-logo { fill: var(--ui-ig-cd, var(--ui-ig-c, var(--ui-ig-ink))); }
`;
