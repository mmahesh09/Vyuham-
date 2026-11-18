"use client";

import { useEffect, useRef } from "react";

/* The 404 backdrop: an arch of warm particles over dunes, with one small figure at the horizon. */

const BACKGROUND = "#070504";
const SPARK_COLOURS = ["255,236,218", "255,214,176", "255,179,122", "240,122,43"];
const FRAME_MS = 1000 / 24;

type Star = { x: number; y: number; size: number; colour: string; phase: number; speed: number };

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function layout(w: number, h: number) {
  const groundY = h * 0.86;
  const cx = w / 2;
  const cy = h * 0.72;
  return { groundY, cx, cy, rx: Math.max(w * 0.39, 232), ry: h * 0.62, innerLeft: w * 0.44, innerRight: w * 0.56 };
}

/** The top edge of the sand at x: a flat floor rising into a dune on each side. */
function sandTop(x: number, w: number, h: number) {
  const { groundY, innerLeft, innerRight } = layout(w, h);
  const rise = h * Math.min(1, w / (h * 1.15)); // narrow screens get gentler dunes
  if (x < innerLeft) return groundY - rise * 0.15 * ((innerLeft - x) / innerLeft) ** 2;
  if (x > innerRight) return groundY - rise * 0.23 * ((x - innerRight) / (w - innerRight)) ** 2;
  return groundY;
}

function drawArch(ctx: CanvasRenderingContext2D, w: number, h: number, random: () => number, unit: number) {
  const { cx, cy, rx, ry } = layout(w, h);
  const count = Math.min(42000, Math.max(11000, (w * h) / (unit * unit * 28)));

  // A soft haze under the particles makes the arch read as one body of light.
  ctx.save();
  ctx.filter = `blur(${Math.round(rx * 0.05)}px)`;
  ctx.strokeStyle = "rgba(255,164,104,0.075)";
  ctx.lineWidth = rx * 0.14;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 0.93, ry * 0.93, 0, Math.PI - 0.1, Math.PI * 2 + 0.1);
  ctx.stroke();
  ctx.restore();

  for (let i = 0; i < count; i++) {
    const inBand = i < count * 0.8;
    const angle = Math.PI - 0.16 + random() * (Math.PI + 0.32);
    // Clumps along the arch keep it from looking like a drawn line.
    if (inBand && random() > 0.62 + 0.38 * Math.sin(angle * 9 + 1.4) * Math.sin(angle * 23)) continue;
    const spread = (random() + random() + random()) / 3;
    const radius = inBand ? 1.035 - Math.abs(spread - 0.5) * 0.52 - random() * 0.05 : Math.sqrt(random()) * 0.98;
    const glow = inBand ? 0.34 + 0.66 * random() ** 1.6 : 0.08 + 0.5 * random() ** 3;
    const size = unit * (random() > 0.98 ? 2 : 0.7 + random() * 0.7);
    ctx.fillStyle = `rgba(${SPARK_COLOURS[Math.floor(random() ** 1.4 * SPARK_COLOURS.length)]},${glow})`;
    ctx.fillRect(cx + rx * radius * Math.cos(angle), cy + ry * radius * Math.sin(angle), size, size);
  }
}

function drawSand(ctx: CanvasRenderingContext2D, w: number, h: number, random: () => number, unit: number) {
  const fill = ctx.createLinearGradient(0, h * 0.62, 0, h);
  fill.addColorStop(0, "#2a1a12");
  fill.addColorStop(0.62, "#160d09");
  fill.addColorStop(1, BACKGROUND);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 6 * unit) ctx.lineTo(x, sandTop(x, w, h));
  ctx.lineTo(w, sandTop(w, w, h));
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();

  // Short horizontal flecks read as wind-blown ripples, brightest along each crest.
  const flecks = Math.min(16000, (w * h) / (unit * unit * 70));
  for (let i = 0; i < flecks; i++) {
    const x = random() * w;
    const top = sandTop(x, w, h);
    const depth = random() ** 2.2;
    const y = top + depth * (h - top);
    const alpha = (1 - depth) ** 3 * (0.08 + random() * 0.34);
    ctx.fillStyle = `rgba(255,190,140,${alpha})`;
    ctx.fillRect(x, y, unit * (1 + random() * 8), unit * 0.7);
  }
}

function drawFigure(ctx: CanvasRenderingContext2D, x: number, feetY: number, height: number, unit: number) {
  const body = new Path2D(
    "M-.026-.885V-.855C-.055-.845-.09-.825-.098-.775L-.122-.5C-.125-.47-.105-.46-.1-.49L-.092-.56C-.1-.4-.13-.25-.12-.16L-.07-.15-.058-.02-.085 0H-.03L-.015-.15H.02L.03-.02.015 0H.075L.062-.15.118-.17C.125-.3.1-.42.09-.56L.1-.49C.105-.46.125-.47.122-.5L.098-.775C.09-.825.055-.845.026-.855V-.885Z",
  );
  ctx.save();
  ctx.translate(x, feetY);
  ctx.scale(height, height);
  ctx.fillStyle = "#040201";
  ctx.strokeStyle = "rgba(255,176,120,0.42)";
  ctx.lineWidth = (0.8 * unit) / height;
  ctx.fill(body);
  ctx.stroke(body);
  ctx.beginPath();
  ctx.arc(0, -0.935, 0.056, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, unit: number) {
  const random = seededRandom(1977);
  const { cx, groundY } = layout(w, h);
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, w, h);
  drawArch(ctx, w, h, random, unit);

  const glowRadius = Math.max(w * 0.2, h * 0.36);
  const glow = ctx.createRadialGradient(cx, groundY, 0, cx, groundY, glowRadius);
  glow.addColorStop(0, "rgba(255,164,96,0.5)");
  glow.addColorStop(0.42, "rgba(240,122,43,0.15)");
  glow.addColorStop(1, "rgba(240,122,43,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(cx - glowRadius, groundY - glowRadius, glowRadius * 2, glowRadius * 2);

  drawSand(ctx, w, h, random, unit);

  // The dark pool the figure stands in.
  ctx.save();
  ctx.translate(cx, groundY + h * 0.035);
  ctx.scale(1, 0.2);
  const poolRadius = Math.max(w * 0.17, 130 * unit);
  const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, poolRadius);
  pool.addColorStop(0, "rgba(3,2,1,0.96)");
  pool.addColorStop(0.55, "rgba(3,2,1,0.72)");
  pool.addColorStop(1, "rgba(3,2,1,0)");
  ctx.fillStyle = pool;
  ctx.fillRect(-poolRadius, -poolRadius, poolRadius * 2, poolRadius * 2);
  ctx.restore();

  drawFigure(ctx, cx, groundY + 3 * unit, Math.min(104 * unit, Math.max(66 * unit, h * 0.115)), unit);
}

function makeStars(w: number, h: number, unit: number): Star[] {
  const random = seededRandom(404);
  const { cx, cy, rx, ry } = layout(w, h);
  return Array.from({ length: 120 }, () => {
    const angle = Math.PI + random() * Math.PI;
    const radius = 0.3 + random() * 0.72;
    return {
      x: cx + rx * radius * Math.cos(angle),
      y: cy + ry * radius * Math.sin(angle),
      size: unit * (1 + random() * 1.1),
      colour: SPARK_COLOURS[Math.floor(random() * 3)],
      phase: random() * Math.PI * 2,
      speed: 0.5 + random() * 1.1,
    };
  });
}

export function NotFoundScene() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const backdrop = document.createElement("canvas");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let stars: Star[] = [];
    let onScreen = true;
    let frame = 0;
    let last = 0;

    const draw = (seconds: number) => {
      ctx.drawImage(backdrop, 0, 0);
      for (const s of stars) {
        ctx.fillStyle = `rgba(${s.colour},${0.32 + 0.5 * Math.abs(Math.sin(seconds * s.speed + s.phase))})`;
        ctx.fillRect(s.x, s.y, s.size, s.size);
      }
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const unit = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(rect.width * unit));
      const h = Math.max(1, Math.round(rect.height * unit));
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = backdrop.width = w;
      canvas.height = backdrop.height = h;
      const backdropCtx = backdrop.getContext("2d");
      if (backdropCtx) drawScene(backdropCtx, w, h, unit);
      stars = makeStars(w, h, unit);
      draw(1);
    };
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < FRAME_MS) return;
      last = now;
      draw(now / 1000);
    };
    const sync = () => {
      const run = onScreen && !document.hidden && !motion.matches;
      if (run && !frame) frame = requestAnimationFrame(tick);
      else if (!run && frame) {
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
