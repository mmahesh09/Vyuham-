"use client";

import { DottedMap } from "@/components/ui/dotted-map";

import { CITIES, type CityMarker } from "./map-data";

/** The Magic UI dotted map with revenue hot-spots. Rendered in the browser to keep the page HTML small. */
export default function DottedWorldMap() {
  return (
    <DottedMap<CityMarker>
      width={150}
      height={75}
      mapSamples={3800}
      dotRadius={0.24}
      dotColor="rgba(206,163,245,0.4)"
      markerColor="#cb72d0"
      markers={CITIES}
      aria-hidden
      renderMarkerOverlay={({ marker, x, y, r }) => (
        <>
          <circle cx={x} cy={y} r={r} fill="none" stroke="#cb72d0" strokeWidth={0.3} className="map-pulse" />
          {marker.label && (
            <g>
              <rect x={x + r + 1} y={y - 2.4} width={marker.city.length * 1.35 + 7} height={4.8} rx={2.4} fill="#14081d" fillOpacity={0.9} stroke="rgba(255,255,255,0.15)" strokeWidth={0.15} />
              <text x={x + r + 2.6} y={y + 0.9} fontSize={2.4} fill="#ffffff" style={{ fontFamily: "var(--font-outfit), sans-serif" }}>
                {marker.city} <tspan fill="#cea3f5">{marker.share}%</tspan>
              </text>
            </g>
          )}
        </>
      )}
    />
  );
}
