import { ArrowDownRight, ArrowUpRight, Sparkle } from "lucide-react";

/**
 * Product-style infographics for the auth panel: a mini dashboard window with KPI tiles,
 * a bar chart and a donut, plus floating cards (AI answer, sparkline KPI).
 * Illustrative sample numbers only; static markup, no client JS.
 */

const card = "rounded-2xl border border-line bg-surface/80 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)] backdrop-blur-md";

const KPIS = [
  { label: "Revenue", value: "$48.2k", delta: "+12.4%", up: true },
  { label: "Orders", value: "1,284", delta: "+8.1%", up: true },
  { label: "Avg. order", value: "$37.60", delta: "-2.3%", up: false },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"];
const REVENUE = [42, 55, 48, 63, 58, 72, 66, 88]; // % of chart height

const CHANNELS = [
  { label: "Online", pct: 58, color: "var(--primary)" },
  { label: "Retail", pct: 27, color: "var(--highlight)" },
  { label: "Wholesale", pct: 15, color: "var(--accent)" },
];

function Delta({ value, up }: { value: string; up: boolean }) {
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${up ? "text-highlight" : "text-accent"}`}>
      <Icon className="size-3" strokeWidth={2.2} aria-hidden />
      {value}
    </span>
  );
}

function BarChart() {
  const peak = REVENUE.length - 1;
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-line/70 bg-bg/40 p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium text-muted">Revenue by month</span>
        <span className="text-[10px] text-faint">2026</span>
      </div>
      <div className="relative h-[92px]">
        {/* gridlines */}
        {[0, 1, 2].map((i) => (
          <span key={i} className="absolute inset-x-0 border-t border-dashed border-line/70" style={{ top: `${i * 33}%` }} />
        ))}
        <div className="relative flex h-full items-end gap-[6px]">
          {REVENUE.map((h, i) => (
            <div key={i} className="relative flex-1" style={{ height: `${h}%` }}>
              <div
                className={`h-full rounded-t-[4px] ${
                  i === peak ? "bg-gradient-to-t from-primary to-highlight" : "bg-gradient-to-t from-line to-[#3a3170]"
                }`}
              />
              {i === peak && (
                <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-highlight px-1.5 py-0.5 text-[10px] font-semibold text-bg">
                  $9.1k
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-[6px]">
        {MONTHS.map((m) => (
          <span key={m} className="flex-1 text-center text-[9px] text-faint">
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}

function Donut() {
  const r = 26;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line/70 bg-bg/40 p-3">
      <span className="text-[11px] font-medium text-muted">Channel mix</span>
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 64 64" className="size-[66px] shrink-0 -rotate-90">
          <circle cx="32" cy="32" r={r} fill="none" stroke="var(--line)" strokeWidth="9" />
          {CHANNELS.map(({ label, pct, color }) => {
            const len = (pct / 100) * c;
            const seg = (
              <circle
                key={label}
                cx="32"
                cy="32"
                r={r}
                fill="none"
                stroke={color}
                strokeWidth="9"
                strokeDasharray={`${Math.max(len - 2, 0)} ${c}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return seg;
          })}
        </svg>
        <ul className="flex flex-col gap-1.5">
          {CHANNELS.map(({ label, pct, color }) => (
            <li key={label} className="flex items-center gap-1.5 text-[10px] text-muted">
              <span className="size-1.5 rounded-full" style={{ background: color }} />
              {label}
              <span className="ml-auto pl-2 font-medium text-text">{pct}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Sparkline() {
  const pts = [18, 22, 19, 27, 25, 31, 29, 36, 34, 42];
  const w = 120;
  const h = 36;
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * w, h - ((v - min) / (max - min)) * (h - 4) - 2] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-[120px] overflow-visible">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--highlight)" stopOpacity="0.35" />
          <stop offset="1" stopColor="var(--highlight)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill="url(#spark-fill)" />
      <path d={line} fill="none" stroke="var(--highlight)" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="3" fill="var(--highlight)" />
      <circle cx={lx} cy={ly} r="6" fill="var(--highlight)" opacity="0.2" />
    </svg>
  );
}

export function AuthInfographics() {
  return (
    <div className="relative mx-auto w-full max-w-[500px] px-8">
      {/* Floating AI answer */}
      <div className={`${card} float-slow absolute -left-2 -top-12 z-20 flex max-w-[230px] gap-2.5 p-3 [--float-delay:-2s]`}>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary">
          <Sparkle className="size-3.5 text-white" strokeWidth={2} aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-faint">Which region grew fastest?</span>
          <span className="text-[12px] leading-snug text-text">
            North, <span className="font-semibold text-highlight">+18%</span> vs last month.
          </span>
        </div>
      </div>

      {/* Floating sparkline KPI */}
      <div className={`${card} float-slow absolute -bottom-12 -right-2 z-20 flex flex-col gap-1.5 p-3 [--float-delay:-5s]`}>
        <span className="text-[11px] text-faint">Active clients</span>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-lg font-semibold tracking-tight">312</span>
          <Delta value="+24" up />
        </div>
        <Sparkline />
      </div>

      {/* Dashboard window */}
      <div className={`${card} relative z-10 flex flex-col gap-3 p-3.5`}>
        <div className="flex items-center gap-2">
          <span className="flex gap-1">
            <span className="size-2 rounded-full bg-line" />
            <span className="size-2 rounded-full bg-line" />
            <span className="size-2 rounded-full bg-line" />
          </span>
          <span className="ml-1 text-[11px] font-medium text-muted">Sales overview</span>
          <span className="text-[11px] text-faint">· Last 30 days</span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10px] text-highlight">
            <span className="size-1.5 animate-pulse rounded-full bg-highlight motion-reduce:animate-none" />
            Live
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {KPIS.map((k) => (
            <div key={k.label} className="flex flex-col gap-0.5 rounded-xl border border-line/70 bg-bg/40 px-2.5 py-2">
              <span className="text-[10px] text-faint">{k.label}</span>
              <span className="font-display text-[15px] font-semibold tracking-tight text-text">{k.value}</span>
              <Delta value={k.delta} up={k.up} />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[1.45fr_1fr] gap-2">
          <BarChart />
          <Donut />
        </div>
      </div>
    </div>
  );
}
