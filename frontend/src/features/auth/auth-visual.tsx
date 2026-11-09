import { Mark } from "@/components/ui/mark";

import { AuthInfographics } from "./auth-infographics";

/**
 * Right-hand panel of the auth screens: the product promise over an isometric bar chart
 * circled by an orbit ring. Pure SVG, computed at render; no client JS.
 */

const COS = Math.cos(Math.PI / 6);
const SIN = 0.5;

/** World (x, y on the ground, z up) → screen. */
function iso(x: number, y: number, z: number): [number, number] {
  return [(x - y) * COS, (x + y) * SIN - z];
}

const pts = (list: [number, number, number][]) =>
  list
    .map((p) => iso(...p))
    .map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`)
    .join(" ");

const U = 54; // bar footprint
const GAP = 1.8 * U;
const HEIGHTS = [84, 138, 108, 196];
const ROW = GAP * (HEIGHTS.length - 1) + U;

const bars = HEIGHTS.map((h, i) => {
  const x = i * GAP - ROW / 2;
  const y = -U / 2;
  return {
    h,
    top: pts([
      [x, y, h],
      [x + U, y, h],
      [x + U, y + U, h],
      [x, y + U, h],
    ]),
    // Face toward the viewer's left (y = max) and right (x = max).
    left: pts([
      [x, y + U, 0],
      [x + U, y + U, 0],
      [x + U, y + U, h],
      [x, y + U, h],
    ]),
    right: pts([
      [x + U, y, 0],
      [x + U, y + U, 0],
      [x + U, y + U, h],
      [x + U, y, h],
    ]),
    x,
    y,
  };
});

// Selection outline around the tallest bar's top, like a 3D editor handle.
const hero = bars[bars.length - 1];
const M = 16;
const handleCorners: [number, number, number][] = [
  [hero.x - M, hero.y - M, hero.h],
  [hero.x + U + M, hero.y - M, hero.h],
  [hero.x + U + M, hero.y + U + M, hero.h],
  [hero.x - M, hero.y + U + M, hero.h],
];
const handle = handleCorners.map((c) => iso(...c));

const ORBIT = { cx: 0, cy: -70, rx: 300, ry: 66 };
const backArc = `M ${ORBIT.cx - ORBIT.rx} ${ORBIT.cy} A ${ORBIT.rx} ${ORBIT.ry} 0 0 1 ${ORBIT.cx + ORBIT.rx} ${ORBIT.cy}`;
const frontArc = `M ${ORBIT.cx + ORBIT.rx} ${ORBIT.cy} A ${ORBIT.rx} ${ORBIT.ry} 0 0 1 ${ORBIT.cx - ORBIT.rx} ${ORBIT.cy}`;
const arrowY = ORBIT.cy + ORBIT.ry;

export function AuthVisual({ className = "" }: { className?: string }) {
  return (
    <aside
      aria-hidden
      className={`relative isolate flex-col items-center overflow-hidden border-line bg-[#06050c] lg:border-l ${className}`}
    >
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_45%_at_50%_100%,rgba(112,92,187,0.22),transparent_70%),radial-gradient(40%_30%_at_50%_0%,rgba(206,163,245,0.08),transparent_70%)]" />

      <p className="mt-[clamp(48px,9vh,110px)] max-w-[520px] px-8 text-center font-display text-[clamp(30px,2.6vw,42px)] font-medium leading-[1.15] tracking-tight">
        <span className="block text-text">Upload a spreadsheet.</span>
        <span className="block bg-gradient-to-b from-muted to-faint/70 bg-clip-text text-transparent">Ask in plain English.</span>
        <span className="block text-text">
          <Mark sweepOnLoad>Get the answer and the chart.</Mark>
        </span>
      </p>
      <p className="mt-5 max-w-[440px] px-8 text-center text-[15px] font-light leading-relaxed text-muted">
        An AI dashboard for small businesses. Works with Excel, CSV and Google Sheets. No formulas, no data model, no
        analyst needed.
      </p>

      <div className="relative mt-[clamp(56px,9vh,84px)] w-full">
        <AuthInfographics />
      </div>

      <div className="relative w-full max-w-[600px] flex-1 [@media(max-height:820px)]:hidden">
        <svg viewBox="-330 -215 660 290" className="absolute bottom-0 left-0 w-full">
          <defs>
            <linearGradient id="av-top" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#2c2560" />
              <stop offset="1" stopColor="#1b163d" />
            </linearGradient>
            <linearGradient id="av-hero" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#a48ff0" />
              <stop offset="1" stopColor="#6450b4" />
            </linearGradient>
            <linearGradient id="av-face" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#1a1636" />
              <stop offset="1" stopColor="#0b0918" />
            </linearGradient>
            <linearGradient id="av-face-dark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#120f27" />
              <stop offset="1" stopColor="#07060f" />
            </linearGradient>
            <linearGradient id="av-ring" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#cea3f5" stopOpacity="0.15" />
              <stop offset="0.5" stopColor="#cea3f5" stopOpacity="0.9" />
              <stop offset="1" stopColor="#cea3f5" stopOpacity="0.15" />
            </linearGradient>
            <filter id="av-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="14" />
            </filter>
          </defs>

          {/* Guides from the handle corners down to the floor. */}
          {handle.slice(1).map(([x, y], i) => (
            <line key={i} x1={x} y1={y} x2={x} y2={70} stroke="#cea3f5" strokeOpacity="0.14" />
          ))}

          <path d={backArc} fill="none" stroke="url(#av-ring)" strokeOpacity="0.45" strokeWidth="1.25" />

          <polygon points={hero.top} fill="#8d78e0" opacity="0.35" filter="url(#av-glow)" />

          {bars.map((b, i) => {
            const isHero = i === bars.length - 1;
            return (
              <g key={i}>
                <polygon points={b.left} fill="url(#av-face)" stroke="#2a2357" strokeOpacity="0.6" strokeWidth="0.75" />
                <polygon points={b.right} fill="url(#av-face-dark)" stroke="#2a2357" strokeOpacity="0.6" strokeWidth="0.75" />
                <polygon points={b.top} fill={isHero ? "url(#av-hero)" : "url(#av-top)"} stroke={isHero ? "#cea3f5" : "#3a3170"} strokeWidth="0.75" />
              </g>
            );
          })}

          <polygon
            points={handle.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
            fill="none"
            stroke="#cea3f5"
            strokeOpacity="0.55"
            strokeDasharray="5 6"
          />
          {handle.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="4.5" fill="#06050c" stroke="#cea3f5" strokeWidth="1.5" />
          ))}

          <path d={frontArc} fill="none" stroke="url(#av-ring)" strokeWidth="1.5" />
          <path d={`M 10 ${arrowY} L -14 ${arrowY - 12} L -8 ${arrowY} L -14 ${arrowY + 12} Z`} fill="#cea3f5" />
        </svg>
      </div>
    </aside>
  );
}
