import type { CSSProperties } from "react";

/* Shared marketing layout + type tokens (8px grid). Outfit is wider than a grotesk, so tracking is eased a little. */
export const container = "mx-auto w-full max-w-[1200px] px-[clamp(16px,5vw,48px)]";
export const sectionY = "py-[clamp(72px,12vw,160px)]";
export const h2 = "text-balance text-[clamp(32px,4.8vw,62px)] font-semibold leading-[1.04] tracking-[-0.035em] text-white";
export const quiet = "font-extralight text-muted/80"; // the second, quieter clause: 200 against 600
export const body = "text-[17px] font-light leading-[1.7] text-muted";
export const card = "rounded-[16px] border border-white/10 bg-black/40";
export const delay = (ms: number) => ({ "--delay": `${ms}ms` }) as CSSProperties;
