"use client";

import { ArrowDownRight, ArrowUpRight, RefreshCw, Sparkle } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

/* Sample data that moves like a live business. All figures are illustrative. */

const C = { line: "#cea3f5", bar: "#705cbb", hot: "#cb72d0", grid: "rgba(255,255,255,0.06)", axis: "#8f86b3" };

// Seeded random so server and first client render match.
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** True while the element is on screen and the viewer allows motion. */
function useLive(ref: RefObject<HTMLElement | null>) {
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !ref.current) return;
    const io = new IntersectionObserver(([e]) => setLive(e.isIntersecting), { threshold: 0.15 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [ref]);
  return live;
}

function useTick(live: boolean, ms: number, fn: () => void) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => fnRef.current(), ms);
    return () => clearInterval(id);
  }, [live, ms]);
}

/** ResponsiveContainer that starts at a positive size, so the first (pre-measure) render does not warn about width/height -1. */
function Fit({ children }: { children: React.ReactElement }) {
  return (
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 1, height: 1 }}>
      {children}
    </ResponsiveContainer>
  );
}

const usd = (v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`;

function GlassTooltip({ active, payload, label }: TooltipContentProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[10px] border border-white/10 bg-[#14081d]/90 px-3 py-2 text-xs shadow-xl backdrop-blur-md">
      {label !== undefined && <p className="text-white/55">{label}</p>}
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="font-semibold text-white">
          {typeof p.value === "number" ? usd(p.value) : p.value}
        </p>
      ))}
    </div>
  );
}

export function LiveBadge({ label = "Live" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-medium text-white/80">
      <span className="relative flex size-2">
        <span className="live-ping absolute inline-flex size-full rounded-full bg-accent opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-accent" />
      </span>
      {label}
    </span>
  );
}

/* ---------------- Live dashboard (product showcase) ---------------- */

type Point = { t: string; v: number };

function initialStream(n: number): Point[] {
  const r = seeded(7);
  let v = 1800;
  return Array.from({ length: n }, (_, i) => {
    v = Math.max(900, v + (r() - 0.42) * 260);
    return { t: `${String(9 + Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`, v: Math.round(v) };
  });
}

function nextTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const total = (h * 60 + m + 15) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

const CHANNELS = [
  { name: "Direct", v: 42 },
  { name: "Email", v: 28 },
  { name: "Ads", v: 19 },
  { name: "Referral", v: 11 },
];

function Kpi({ label, value, delta, up, spark }: { label: string; value: string; delta: string; up: boolean; spark: number[] }) {
  const data = spark.map((v, i) => ({ i, v }));
  return (
    <div className="glass flex flex-col gap-2 rounded-[18px] p-4">
      <p className="text-[13px] text-white/60">{label}</p>
      <p className="text-[26px] font-light tracking-tight text-white tabular-nums">{value}</p>
      <div className="flex items-end justify-between gap-2">
        <span className={`flex items-center gap-1 text-xs font-semibold ${up ? "text-highlight" : "text-accent"}`}>
          {up ? <ArrowUpRight className="size-3.5" strokeWidth={2.6} aria-hidden /> : <ArrowDownRight className="size-3.5" strokeWidth={2.6} aria-hidden />}
          {delta}
        </span>
        <div className="h-8 w-20" aria-hidden>
          <Fit>
            <LineChart data={data}>
              <Line type="monotone" dataKey="v" stroke={up ? C.line : C.hot} strokeWidth={1.8} dot={false} isAnimationActive={false} />
            </LineChart>
          </Fit>
        </div>
      </div>
    </div>
  );
}

export function LiveDashboard() {
  const ref = useRef<HTMLDivElement>(null);
  const live = useLive(ref);
  const [stream, setStream] = useState<Point[]>(() => initialStream(28));
  const [orders, setOrders] = useState(3184);
  const [visitors, setVisitors] = useState(142);
  const [channels, setChannels] = useState(CHANNELS);

  useTick(live, 1600, () => {
    setStream((s) => {
      const last = s[s.length - 1];
      const v = Math.max(900, Math.round(last.v + (Math.random() - 0.42) * 260));
      return [...s.slice(1), { t: nextTime(last.t), v }];
    });
    if (Math.random() > 0.4) setOrders((o) => o + 1 + Math.floor(Math.random() * 3));
    setVisitors((n) => Math.max(90, n + Math.round((Math.random() - 0.5) * 12)));
    setChannels((cs) => cs.map((c) => ({ ...c, v: Math.max(6, c.v + Math.round((Math.random() - 0.5) * 4)) })));
  });

  const revenue = stream.reduce((a, p) => a + p.v, 0) * 1.6;
  const lastTwo = stream.slice(-2);
  const rising = lastTwo[1].v >= lastTwo[0].v;

  return (
    <div ref={ref} className="glass-strong rounded-[28px] p-3 sm:p-4">
      {/* Ask bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-[18px] border border-primary/60 bg-black/40 px-4 py-3">
        <Sparkle className="size-5 shrink-0 text-highlight" strokeWidth={2} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[15px] text-white">Are we selling more than last month?</span>
        <LiveBadge />
      </div>

      <p className="flex items-start gap-2 px-2 pb-1 pt-5 text-lg font-medium tracking-tight text-white sm:text-xl">
        <ArrowUpRight className="mt-1 size-5 shrink-0 text-highlight" strokeWidth={2.4} aria-hidden />
        Yes. October is up 18% on September, and today is already 12% ahead of a normal Thursday.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Revenue today" value={usd(revenue)} delta="12%" up spark={stream.slice(-12).map((p) => p.v)} />
        <Kpi label="Orders this month" value={orders.toLocaleString("en-US")} delta="6%" up spark={[30, 32, 31, 35, 34, 38, 37, 41, 40, 44]} />
        <Kpi label="Average order" value="$129.60" delta="3%" up={false} spark={[48, 46, 47, 44, 45, 43, 44, 42, 43, 41]} />
        <Kpi label="On site now" value={String(visitors)} delta="live" up spark={stream.slice(-12).map((p) => p.v * 0.08)} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[2fr_1fr]">
        <div className="glass rounded-[18px] p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-white/70">Revenue, every 15 minutes</p>
            <span className={`text-xs font-semibold tabular-nums ${rising ? "text-highlight" : "text-accent"}`}>
              {usd(lastTwo[1].v)} {rising ? "▲" : "▼"}
            </span>
          </div>
          <div className="h-[220px]" role="img" aria-label="Live area chart of revenue every 15 minutes">
            <Fit>
              <AreaChart data={stream} margin={{ top: 6, right: 4, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.hot} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={C.bar} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" tick={{ fill: C.axis, fontSize: 11 }} tickLine={false} axisLine={false} interval={6} />
                <YAxis tick={{ fill: C.axis, fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={usd} width={52} />
                <Tooltip content={(p) => <GlassTooltip {...(p as TooltipContentProps<number, string>)} />} cursor={{ stroke: "rgba(255,255,255,0.15)" }} />
                <Area type="monotone" dataKey="v" stroke={C.line} strokeWidth={2.5} fill="url(#revFill)" isAnimationActive animationDuration={600} />
              </AreaChart>
            </Fit>
          </div>
        </div>
        <div className="glass rounded-[18px] p-4">
          <p className="mb-3 text-sm text-white/70">Where orders come from</p>
          <div className="h-[220px]" role="img" aria-label="Bar chart of orders by channel">
            <Fit>
              <BarChart data={channels} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" tick={{ fill: "#d9d2f2", fontSize: 12 }} tickLine={false} axisLine={false} width={64} />
                <Bar dataKey="v" radius={[0, 8, 8, 0]} barSize={18} isAnimationActive animationDuration={500}>
                  {channels.map((c, i) => (
                    <Cell key={c.name} fill={i === 0 ? C.hot : C.bar} />
                  ))}
                </Bar>
              </BarChart>
            </Fit>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Story feed cards ---------------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"];
const REVENUE = [24, 25.3, 28.2, 27, 31.2, 32.4, 34.6, 36.8, 37.9, 48.2].map((v, i) => ({ m: MONTHS[i], v: v * 1000 }));
const SPEND = [6.4, 6.1, 6.9, 6.3, 6.7, 9.1].map((v, i) => ({ m: MONTHS[i + 4], v: v * 1000 }));
const CLIENTS = [
  { name: "Halden & Co", v: 22 },
  { name: "Mira Foods", v: 16 },
  { name: "Ostro Labs", v: 12 },
  { name: "Others", v: 50 },
];

function FeedCard({ icon, tone, title, note, children }: { icon: "up" | "down"; tone: string; title: string; note: string; children: React.ReactNode }) {
  const Icon = icon === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="glass rounded-[22px] p-5 sm:p-6">
      <p className="flex items-center gap-2 text-base font-semibold tracking-tight text-white sm:text-lg">
        <Icon className={`size-5 shrink-0 ${tone}`} strokeWidth={2.4} aria-hidden />
        {title}
      </p>
      <p className="mt-1 text-sm text-white/55">{note}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export function StoryFeed() {
  const ref = useRef<HTMLDivElement>(null);
  const live = useLive(ref);
  const [rev, setRev] = useState(REVENUE);
  // The current month keeps filling in, like it would mid-month.
  useTick(live, 2200, () =>
    setRev((r) => r.map((p, i) => (i === r.length - 1 ? { ...p, v: Math.min(52000, p.v + Math.random() * 400) } : p))),
  );

  return (
    <div ref={ref} className="flex flex-col gap-4">
      <FeedCard icon="up" tone="text-highlight" title="Revenue up 18% vs last month" note="Monthly revenue · Oct still filling in">
        <div className="h-[140px]" role="img" aria-label="Line chart of monthly revenue, January to October">
          <Fit>
            <AreaChart data={rev} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="feedFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.line} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={C.line} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="m" tick={{ fill: C.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip content={(p) => <GlassTooltip {...(p as TooltipContentProps<number, string>)} />} cursor={{ stroke: "rgba(255,255,255,0.15)" }} />
              <Area type="monotone" dataKey="v" stroke={C.line} strokeWidth={2.5} fill="url(#feedFill)" animationDuration={500} />
            </AreaChart>
          </Fit>
        </div>
      </FeedCard>

      <div className="grid gap-4 sm:grid-cols-[3fr_2fr]">
        <FeedCard icon="down" tone="text-accent" title="Ad spend 30% over average" note="No matching rise in orders">
          <div className="h-[120px]" role="img" aria-label="Bar chart of monthly ad spend, October highest">
            <Fit>
              <BarChart data={SPEND} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="m" tick={{ fill: C.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip content={(p) => <GlassTooltip {...(p as TooltipContentProps<number, string>)} />} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
                <Bar dataKey="v" radius={[6, 6, 0, 0]}>
                  {SPEND.map((s, i) => (
                    <Cell key={s.m} fill={i === SPEND.length - 1 ? C.hot : C.bar} />
                  ))}
                </Bar>
              </BarChart>
            </Fit>
          </div>
        </FeedCard>
        <FeedCard icon="up" tone="text-highlight" title="Halden & Co is 22%" note="Share of revenue this year">
          <div className="relative h-[120px]" role="img" aria-label="Donut chart: Halden & Co 22%, Mira Foods 16%, Ostro Labs 12%, others 50%">
            <Fit>
              <PieChart>
                <Pie data={CLIENTS} dataKey="v" innerRadius="62%" outerRadius="92%" paddingAngle={3} stroke="none" startAngle={90} endAngle={-270}>
                  {CLIENTS.map((c, i) => (
                    <Cell key={c.name} fill={[C.hot, C.line, C.bar, "rgba(255,255,255,0.1)"][i]} />
                  ))}
                </Pie>
              </PieChart>
            </Fit>
            <span className="absolute inset-0 flex items-center justify-center text-lg font-semibold text-white">22%</span>
          </div>
        </FeedCard>
      </div>
    </div>
  );
}

/* ---------------- Bento pieces ---------------- */

export function SyncCard() {
  const ref = useRef<HTMLDivElement>(null);
  const live = useLive(ref);
  const [secs, setSecs] = useState(4);
  const [rows, setRows] = useState(() => {
    const r = seeded(3);
    return Array.from({ length: 24 }, (_, i) => ({ i, v: 40 + Math.round(r() * 30 + i * 1.5) }));
  });
  useTick(live, 1000, () => {
    if (secs >= 6) {
      setSecs(0);
      setRows((rs) => {
        const last = rs[rs.length - 1];
        return [...rs.slice(1), { i: last.i + 1, v: Math.max(30, last.v + Math.round((Math.random() - 0.4) * 10)) }];
      });
    } else setSecs(secs + 1);
  });
  return (
    <div ref={ref} className="flex flex-1 flex-col justify-end gap-3">
      <div className="h-[110px]" aria-hidden>
        <Fit>
          <AreaChart data={rows} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="syncFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.hot} stopOpacity={0.35} />
                <stop offset="100%" stopColor={C.hot} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="v" stroke={C.hot} strokeWidth={2} fill="url(#syncFill)" animationDuration={500} />
          </AreaChart>
        </Fit>
      </div>
      <p className="flex items-center gap-2 text-sm text-white/60">
        <RefreshCw className={`size-3.5 text-highlight ${secs === 0 ? "animate-spin" : ""}`} strokeWidth={2.2} aria-hidden />
        Expenses sheet · synced {secs === 0 ? "just now" : `${secs}s ago`}
      </p>
    </div>
  );
}

const RANGES = { "7D": 7, "30D": 30, "90D": 90 } as const;
type Range = keyof typeof RANGES;

function rangeData(days: number) {
  const r = seeded(days);
  let v = 1200;
  return Array.from({ length: days }, (_, i) => {
    v = Math.max(600, v + (r() - 0.45) * 180);
    return { d: `Day ${i + 1}`, v: Math.round(v) };
  });
}

export function FilterDemo() {
  const [range, setRange] = useState<Range>("30D");
  const data = rangeData(RANGES[range]);
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex w-fit gap-1 rounded-full border border-white/10 bg-white/[0.05] p-1" role="group" aria-label="Date range">
        {(Object.keys(RANGES) as Range[]).map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={range === r}
            onClick={() => setRange(r)}
            className={`min-h-9 rounded-full px-4 text-[13px] font-medium transition-colors ${
              range === r ? "bg-white/15 text-white" : "text-white/60 hover:text-white"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      <div className="h-[110px]" role="img" aria-label={`Daily revenue for the last ${RANGES[range]} days`}>
        <Fit>
          <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <Tooltip content={(p) => <GlassTooltip {...(p as TooltipContentProps<number, string>)} />} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
            <Bar dataKey="v" fill={C.bar} radius={[3, 3, 0, 0]} animationDuration={500} />
          </BarChart>
        </Fit>
      </div>
    </div>
  );
}
