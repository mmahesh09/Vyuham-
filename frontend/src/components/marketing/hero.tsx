import { ArrowRight, Check, MousePointerClick, Search } from "lucide-react";
import Link from "next/link";

import { SiteNav } from "@/components/marketing/site-nav";

/* Sample data for the answer preview: the same October figures the rest of the page quotes. */
const MONTHS = [
  { m: "May", v: 31.4 },
  { m: "Jun", v: 33.0 },
  { m: "Jul", v: 35.8 },
  { m: "Aug", v: 34.1 },
  { m: "Sep", v: 37.9 },
  { m: "Oct", v: 48.2 },
];

const W = 440;
const H = 168;
const PAD_X = 8;
const MIN = 28;
const MAX = 52;
const x = (i: number) => PAD_X + (i * (W - PAD_X * 2)) / (MONTHS.length - 1);
const y = (v: number) => H - ((v - MIN) / (MAX - MIN)) * H;

/** A smooth line through the points (Catmull-Rom turned into cubic Béziers). */
function smoothPath(points: [number, number][]) {
  return points.reduce((d, p, i, a) => {
    if (i === 0) return `M${p[0]},${p[1]}`;
    const p0 = a[i - 2] ?? a[i - 1];
    const p1 = a[i - 1];
    const p3 = a[i + 1] ?? p;
    const c1 = [p1[0] + (p[0] - p0[0]) / 6, p1[1] + (p[1] - p0[1]) / 6];
    const c2 = [p[0] - (p3[0] - p1[0]) / 6, p[1] - (p3[1] - p1[1]) / 6];
    return `${d} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p[0]},${p[1]}`;
  }, "");
}

const POINTS = MONTHS.map((d, i) => [x(i), y(d.v)] as [number, number]);
const LINE = smoothPath(POINTS);
const AREA = `${LINE} L${x(MONTHS.length - 1)},${H} L${x(0)},${H} Z`;
const LAST = POINTS[POINTS.length - 1];

/** What the headline promises: a typed question, a one-line answer and its chart, fed by a pipeline. */
function AnswerPreview() {
  return (
    <figure className="w-full rounded-[16px] border border-white/10 bg-[#120d0a] p-2 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.8)]">
      <div className="flex min-h-11 items-center gap-3 rounded-[10px] border border-white/[0.08] bg-white/[0.04] px-4 text-[15px] text-white">
        <Search className="size-4 shrink-0 text-faint" strokeWidth={1.5} aria-hidden />
        Revenue by month
      </div>

      <div className="px-4 pb-4 pt-6 sm:px-5">
        <p className="text-[18px] font-medium text-white">Total revenue up 27% in October</p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[32px] font-medium leading-none tabular-nums text-white">$48.2k</span>
          <span className="font-mono text-[13px] tabular-nums text-faint">+27% vs September</span>
        </div>

        <svg viewBox={`0 -8 ${W} ${H + 8}`} className="mt-6 h-auto w-full overflow-visible" role="img" aria-label="Revenue rose each month from $31.4k in May to $48.2k in October, with a dip in August">
          <defs>
            <linearGradient id="hero-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f07a2b" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#f07a2b" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[32, 40, 48].map((v) => (
            <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="rgba(251,246,241,0.07)" />
          ))}
          <path d={AREA} fill="url(#hero-area)" />
          <path d={LINE} fill="none" stroke="#f07a2b" strokeWidth={2} strokeLinecap="round" />
          <circle cx={LAST[0]} cy={LAST[1]} r={4} fill="#f07a2b" stroke="#120d0a" strokeWidth={2} />
        </svg>
        <div className="mt-2 flex justify-between font-mono text-[12px] text-faint">
          {MONTHS.map((d, i) => (
            <span key={d.m} className={i === MONTHS.length - 1 ? "text-white/80" : undefined}>{d.m}</span>
          ))}
        </div>
      </div>

      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-4 py-3 font-mono text-[12px] text-faint">
        <Check className="size-4 shrink-0 text-muted" strokeWidth={1.5} aria-hidden />
        <span className="text-muted">06:00 · Daily revenue</span>
        <span>4 steps succeeded · 4.2 s</span>
      </figcaption>
    </figure>
  );
}

export function Hero() {
  return (
    <section id="top" className="px-2 pt-2 sm:px-3 sm:pt-3">
      <div className="theme-dark dark hero-panel relative isolate mx-auto flex min-h-[min(100svh,920px)] max-w-[1440px] flex-col overflow-hidden rounded-[28px] border border-white/[0.06] sm:rounded-[36px]">
        <SiteNav variant="overlay" />

        <div className="mx-auto grid w-full max-w-[1200px] flex-1 items-center gap-12 px-[clamp(20px,5vw,64px)] py-[clamp(48px,7vw,96px)] lg:grid-cols-[11fr_10fr] lg:gap-16">
          <div className="flex flex-col items-start">
            <Link
              href="/#platform"
              className="group inline-flex items-center gap-2 font-mono text-[13px] text-faint transition-colors duration-150 hover:text-white"
            >
              <span className="text-primary">New</span>
              Pipelines, dynamic tables and governance
              <ArrowRight className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" strokeWidth={1.5} aria-hidden />
            </Link>
            <h1 className="mt-6 max-w-[17ch] text-balance text-[clamp(40px,4.6vw,60px)] font-medium leading-[1.04] tracking-[-0.03em] text-white">
              Ask your data, <span className="text-muted/70">and build the pipelines that feed it</span>
            </h1>
            <p className="mt-6 max-w-[36rem] text-[clamp(16px,1.4vw,18px)] leading-[1.65] text-muted">
              Vyuham is one workspace for the people who need the numbers and the people who prepare them. Ask in plain
              English and get a one-line answer with the right chart. Build the pipelines, SQL and self-refreshing
              tables behind it on the same data. Every query follows the same access rules.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link href="/signup" className="btn-primary inline-flex min-h-12 items-center gap-2 rounded-full px-6 text-[15px] font-medium">
                Start free
                <ArrowRight className="size-4" strokeWidth={1.5} aria-hidden />
              </Link>
              <Link href="/try" className="btn-ghost inline-flex min-h-12 items-center gap-2 rounded-full px-6 text-[15px] font-medium">
                <MousePointerClick className="size-4 text-faint" strokeWidth={1.5} aria-hidden />
                Try it with sample data
              </Link>
            </div>
          </div>

          <AnswerPreview />
        </div>
      </div>
    </section>
  );
}
