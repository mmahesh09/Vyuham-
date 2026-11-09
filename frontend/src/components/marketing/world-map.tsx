"use client";

import dynamic from "next/dynamic";

// Loaded and drawn on the client only; the box keeps the map's 2:1 shape so nothing shifts.
const DottedWorldMap = dynamic(() => import("./dotted-world-map"), { ssr: false });

export function WorldMap() {
  return (
    <div className="aspect-[2/1] w-full">
      <DottedWorldMap />
    </div>
  );
}
