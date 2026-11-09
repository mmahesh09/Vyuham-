import { MapPin, Sparkle } from "lucide-react";

import { CITIES } from "./map-data";
import { WorldMap } from "./world-map";

const TOP = [...CITIES].sort((a, b) => b.share - a.share).slice(0, 5);

export function MapSection() {
  return (
    <div className="flex flex-col gap-10">
      {/* Question + answer */}
      <div className="flex flex-col gap-4 md:max-w-[720px]">
        <div className="flex w-fit items-center gap-3 rounded-full border border-primary/60 bg-black/50 py-2.5 pl-4 pr-5 text-[15px] text-white">
          <Sparkle className="size-4 shrink-0 text-highlight" strokeWidth={2} aria-hidden />
          Where do our best customers come from?
        </div>
        <p className="text-[clamp(20px,2.2vw,26px)] font-light leading-snug text-white/85">
          <span className="font-semibold text-white">Mumbai and Bengaluru bring 41% of revenue.</span> London is the
          fastest-growing city this quarter, up 34%.
        </p>
      </div>

      {/* Map + ranking */}
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="relative" role="img" aria-label="World map of revenue by city: Mumbai 24%, Bengaluru 17%, London 14%, New York 12%, Dubai 11%, and smaller shares elsewhere">
          <WorldMap />
        </div>

        <ol className="flex flex-col gap-4" aria-label="Top cities by share of revenue">
          {TOP.map((c, i) => (
            <li key={c.city} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between text-[15px]">
                <span className="flex items-center gap-2 text-white">
                  <MapPin className={`size-3.5 ${i === 0 ? "text-accent" : "text-white/40"}`} strokeWidth={2.2} aria-hidden />
                  {c.city}
                </span>
                <span className="font-mono text-[13px] text-white/60">{c.share}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                <div className={`h-full rounded-full ${i === 0 ? "bg-accent" : "bg-primary"}`} style={{ width: `${(c.share / TOP[0].share) * 100}%` }} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
