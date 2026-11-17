import { CITIES } from "./map-data";
import { CITY_POSITIONS, WORLD_DOTS_PATH, WORLD_HEIGHT, WORLD_WIDTH } from "./world-dots";

const DOT_COLOR = "rgba(255,179,122,0.4)";
const MARKER_COLOR = "#f2545b";

/**
 * The dotted world map with revenue hot-spots. The dots are precomputed (scripts/world-dots.mjs), so
 * drawing it costs the browser one SVG path instead of seconds of geometry on the main thread.
 */
export default function DottedWorldMap() {
  return (
    <svg viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`} className="h-full w-full" aria-hidden>
      <path d={WORLD_DOTS_PATH} fill={DOT_COLOR} />
      {CITIES.map((c) => {
        const pos = CITY_POSITIONS[c.city];
        if (!pos) return null;
        const { x, y } = pos;
        const r = c.size ?? 0.24;
        return (
          <g key={c.city}>
            <circle cx={x} cy={y} r={r} fill={MARKER_COLOR} />
            <circle cx={x} cy={y} r={r} fill="none" stroke={MARKER_COLOR} strokeWidth={0.3} className="map-pulse" />
            {c.label && (
              <g>
                <rect
                  x={x + r + 1}
                  y={y - 2.4}
                  width={c.city.length * 1.35 + 7}
                  height={4.8}
                  rx={2.4}
                  fill="#19110c"
                  fillOpacity={0.9}
                  stroke="rgba(255,255,255,0.15)"
                  strokeWidth={0.15}
                />
                <text x={x + r + 2.6} y={y + 0.9} fontSize={2.4} fill="#ffffff" style={{ fontFamily: "var(--font-outfit), sans-serif" }}>
                  {c.city} <tspan fill="#ffb37a">{c.share}%</tspan>
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
