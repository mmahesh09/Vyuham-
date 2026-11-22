import { cn } from "@/lib/utils";

import type { Layer } from "./api";

// Medallion layers in metal tones that sit with the brand's warm palette.
const STYLE: Record<Layer, string> = {
  bronze: "border-[#c98a5a]/50 bg-[#c98a5a]/12 text-[#e0a77a]",
  silver: "border-[#b8b8c4]/45 bg-[#b8b8c4]/10 text-[#cfd0da]",
  gold: "border-[#e6b84a]/55 bg-[#e6b84a]/12 text-[#f0c860]",
};
const LABEL: Record<Layer, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold" };

/** Bronze / Silver / Gold tag for a dataset. */
export function LayerBadge({ layer, compact = false }: { layer: Layer; compact?: boolean }) {
  return (
    <span
      title={`${LABEL[layer]} layer`}
      className={cn(
        "inline-flex shrink-0 items-center rounded-[4px] border font-semibold uppercase tracking-[0.06em]",
        compact ? "px-1 text-[9.5px]" : "px-1.5 py-0.5 text-[10.5px]",
        STYLE[layer],
      )}
    >
      {compact ? LABEL[layer][0] : LABEL[layer]}
    </span>
  );
}
