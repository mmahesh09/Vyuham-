import type { CSSProperties } from "react";

/* Shared marketing layout + type tokens (8px grid). Outfit is wider than a grotesk, so tracking is eased a little. */
export const container = "mx-auto w-full max-w-[1200px] px-[clamp(16px,5vw,48px)]";
export const sectionY = "py-[clamp(72px,12vw,160px)]";
export const h2 = "text-balance text-[clamp(32px,4.4vw,56px)] font-medium leading-[1.06] tracking-[-0.03em] text-white";
export const quiet = "text-muted/70"; // the second, quieter clause: same weight, hierarchy from colour
export const body = "text-[17px] leading-[1.7] text-muted";
export const card = "rounded-[16px] border border-white/10 bg-black/40";
export const delay = (ms: number) => ({ "--delay": `${ms}ms` }) as CSSProperties;
