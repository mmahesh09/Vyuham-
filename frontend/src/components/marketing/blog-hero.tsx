"use client";

import { useEffect, useRef, type ReactNode } from "react";

/*
 * The blog's header: a slowly shifting quilt of coral tiles behind the page title. This is only the
 * "Pixel coral" look from a Feral UI gradient export, so the blog doesn't load the whole gradient engine.
 */

const STOPS = ["#F04E36", "#F87A5C", "#FBA184", "#FFCBB4", "#F9EFEA"];
const STOP_POSITIONS = [0.1, 0.3, 0.5, 0.7, 0.9];
const FALLBACK = `linear-gradient(100deg, ${STOPS.join(", ")})`;

const TILES_ON_SHORT_EDGE = 12;
const BANDS = 12;
const START_TIME = 51.35;
const TIME_PER_SECOND = 0.36;
const FRAME_MS = 1000 / 30;
const MAX_EDGE = 2560;

type Lab = [number, number, number];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function hexToOklab(hex: string): Lab {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToCss([L, a, b]: Lab) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => Math.round(255 * clamp01(c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055)));
  return `rgb(${channels.join(",")})`;
}

/** 256 colours along the palette, so a frame never has to convert colours. */
function buildPalette() {
  const labs = STOPS.map(hexToOklab);
  return Array.from({ length: 256 }, (_, i) => {
    const t = i / 255;
    const next = STOP_POSITIONS.findIndex((p) => t <= p);
    if (next === 0) return oklabToCss(labs[0]);
    if (next === -1) return oklabToCss(labs[labs.length - 1]);
    const f = (t - STOP_POSITIONS[next - 1]) / (STOP_POSITIONS[next] - STOP_POSITIONS[next - 1]);
    const [from, to] = [labs[next - 1], labs[next]];
    return oklabToCss([from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, from[2] + (to[2] - from[2]) * f]);
  });
}

function tileNoise(row: number, col: number) {
  const n = Math.sin(row * 127.1 + col * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** How far along the palette one tile sits: light around a focus on the right, coral away from it. */
function tileValue(x: number, y: number, row: number, col: number, time: number) {
  const focusX = 0.82 + 0.014 * Math.sin(time * 0.72);
  const focusY = 0.52 + 0.01 * Math.cos(time * 0.58);
  const breathe = 1 + 0.032 * Math.sin(time * 2.4);
  const skewedX = x + (y - focusY) * 0.14 + 0.028 * Math.sin(y * Math.PI * 1.15 + 0.35);
  const distance = Math.max(Math.abs(skewedX - focusX) / (0.86 * breathe), Math.abs(y - focusY) / (0.64 * breathe));
  const sweep = clamp01(x * 0.86 + (1 - Math.abs(y - focusY) * 2) * 0.14);
  const value = clamp01((1 - clamp01(distance)) * 0.78 + sweep * 0.22);
  const noise = tileNoise(row, col);
  const jitter = (noise - 0.5) * 0.09 * 0.2;
  const shimmer = 0.018 * Math.sin(time * 1.1 + noise * Math.PI * 2);
  return clamp01(Math.round(value * BANDS) / BANDS + jitter + shimmer);
}

function paint(ctx: CanvasRenderingContext2D, width: number, height: number, palette: string[], time: number) {
  const tile = Math.min(width, height) / TILES_ON_SHORT_EDGE;
  const cols = Math.max(4, Math.round(width / tile));
  const rows = Math.max(4, Math.round(height / tile));
  const cw = width / cols;
  const ch = height / rows;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      ctx.fillStyle = palette[Math.round(tileValue((col + 0.5) / cols, (row + 0.5) / rows, row, col, time) * 255)];
      ctx.fillRect(Math.floor(col * cw), Math.floor(row * ch), Math.ceil(cw) + 1, Math.ceil(ch) + 1);
    }
  }
  // A light and a dark hairline side by side give each tile a soft edge.
  const line = Math.max(0.65, Math.min(cw, ch) * 0.014);
  for (const [style, offset] of [["rgba(255,255,255,0.12)", -line], ["rgba(240,78,54,0.075)", 0]] as const) {
    ctx.fillStyle = style;
    for (let col = 1; col < cols; col++) ctx.fillRect(Math.round(col * cw) + offset, 0, line, height);
    for (let row = 1; row < rows; row++) ctx.fillRect(0, Math.round(row * ch) + offset, width, line);
  }
}

function QuiltCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const palette = buildPalette();
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let time = START_TIME;
    let onScreen = true;
    let frame = 0;
    let last = 0;

    const draw = () => paint(ctx, canvas.width, canvas.height, palette, time);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const scale = Math.min(dpr, MAX_EDGE / Math.max(1, rect.width, rect.height));
      canvas.width = Math.max(1, Math.round(rect.width * scale));
      canvas.height = Math.max(1, Math.round(rect.height * scale));
      draw();
    };
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < FRAME_MS - 1) return;
      time += (Math.min(100, now - last) / 1000) * TIME_PER_SECOND;
      last = now;
      draw();
    };
    // The animation only runs while someone can see it.
    const sync = () => {
      const run = onScreen && !document.hidden && !motion.matches;
      if (run && !frame) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      } else if (!run && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };

    const sizes = new ResizeObserver(resize);
    sizes.observe(canvas);
    const visibility = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    });
    visibility.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    motion.addEventListener("change", sync);
    resize();
    sync();

    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      visibility.disconnect();
      document.removeEventListener("visibilitychange", sync);
      motion.removeEventListener("change", sync);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="absolute inset-0 -z-10 size-full" />;
}

/** The gradient banner at the top of blog pages. Its children sit in the same column as the page below. */
export function BlogHero({ children, column = "max-w-[760px]" }: { children: ReactNode; column?: string }) {
  return (
    <header
      className="relative isolate mx-auto mt-2 w-[calc(100%-16px)] max-w-[1280px] overflow-hidden rounded-[24px] text-[#2a0d07]"
      style={{ background: FALLBACK }}
    >
      <QuiltCanvas />
      <div className={`mx-auto flex w-full flex-col gap-4 px-5 py-[clamp(48px,8vw,96px)] ${column}`}>{children}</div>
    </header>
  );
}
