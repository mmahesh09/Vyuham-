import { Check, Clock, Database, Eye, Lock, RefreshCcw, ShieldCheck, Sparkles } from "lucide-react";

/*
 * Static product illustrations for the engineering half of the homepage. Plain HTML in the same
 * glass style as product-shots.tsx (no canvas library on the landing page). All data is sample data.
 */

const STEPS = [
  { name: "Read orders", kind: "Source", layer: "Bronze", rows: "5,412" },
  { name: "Remove duplicates", kind: "Transform", layer: "Silver", rows: "5,380" },
  { name: "Check customer IDs", kind: "Quality", layer: "Silver", rows: "5,371", note: "9 rows dropped" },
  { name: "Revenue by region", kind: "SQL", layer: "Gold", rows: "6" },
];

/** A finished pipeline run: four steps, rows per step, the quality check's result. */
export function PipelineShot() {
  return (
    <div className="glass-strong rounded-[26px] p-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 pt-3">
        <span className="text-sm font-medium text-white">Daily revenue by region</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-highlight">
          <Check className="size-3.5" strokeWidth={2.4} aria-hidden /> Succeeded · 4.2 s
        </span>
      </div>
      <ol className="flex flex-col">
        {STEPS.map((s, i) => (
          <li key={s.name} className="relative grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-white/[0.07] px-4 py-3.5">
            <span className="flex size-7 items-center justify-center rounded-full border border-white/15 font-mono text-[11px] text-white/70">{i + 1}</span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] text-white">{s.name}</span>
              <span className="block text-[12px] text-white/50">
                {s.kind} · {s.layer}
                {s.note && <span className="text-highlight"> · {s.note}</span>}
              </span>
            </span>
            <span className="font-mono text-[12px] text-white/60">{s.rows} rows</span>
          </li>
        ))}
      </ol>
      <div className="m-2 flex items-start gap-2 rounded-[16px] border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-white">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-highlight" strokeWidth={2} aria-hidden />
        <span>
          <span className="font-semibold text-highlight">Drafted by the AI Data Engineer.</span> Approved by Asha before its first run.
        </span>
      </div>
    </div>
  );
}

const REFRESHES = [
  { name: "customer_revenue", when: "2 min ago", mode: "Incremental", rows: "+128 rows" },
  { name: "orders_clean", when: "14 min ago", mode: "Full", rows: "5,380 rows" },
];

/** SQL Workbench with a query, and two dynamic tables that keep its result fresh. */
export function WorkbenchShot() {
  return (
    <div className="glass-strong rounded-[26px] p-2">
      <div className="flex items-center gap-1 px-3 pt-2 text-[12px]">
        <span className="rounded-t-[8px] border border-b-0 border-white/10 bg-black/40 px-3 py-1.5 text-white">Revenue by region</span>
        <span className="px-3 py-1.5 text-white/45">Churned customers</span>
      </div>
      <pre className="mx-2 overflow-x-auto rounded-[14px] border border-white/[0.07] bg-black/50 p-4 font-mono text-[12.5px] leading-[1.7] text-white/80">
        <span className="text-highlight">SELECT</span> region, <span className="text-highlight">SUM</span>(amount) <span className="text-highlight">AS</span> revenue{"\n"}
        <span className="text-highlight">FROM</span> orders_clean{"\n"}
        <span className="text-highlight">WHERE</span> ordered &gt;= {"{{since}}"}{"\n"}
        <span className="text-highlight">GROUP BY</span> 1 <span className="text-highlight">ORDER BY</span> 2 <span className="text-highlight">DESC</span>
      </pre>
      <p className="px-4 pt-2 text-[12px] text-white/50">6 rows · 38 ms · read-only</p>
      <ul className="mt-2 flex flex-col">
        {REFRESHES.map((r) => (
          <li key={r.name} className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-white/[0.07] px-4 py-3">
            <RefreshCcw className="size-4 text-highlight" strokeWidth={2} aria-hidden />
            <span className="min-w-0">
              <code className="block truncate font-mono text-[13px] text-white">{r.name}</code>
              <span className="text-[12px] text-white/50">{r.mode} refresh · {r.when}</span>
            </span>
            <span className="font-mono text-[12px] text-white/60">{r.rows}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ROWS = [
  ["Asha Rao", "a***@example.com", "North"],
  ["Ravi Kumar", "r***@example.com", "South"],
  ["Meera Shah", "m***@example.org", "North"],
];

/** A table as a viewer sees it (email masked), plus two audit lines. */
export function GovernanceShot() {
  return (
    <div className="glass-strong rounded-[26px] p-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 pt-3">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-white">
          <Eye className="size-4 text-white/60" aria-hidden /> customers, as a viewer sees it
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-highlight">
          <Lock className="size-3.5" aria-hidden /> email: confidential
        </span>
      </div>
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-t border-white/[0.07] text-white/45">
            <th className="px-4 py-2 font-normal">name</th>
            <th className="px-4 py-2 font-normal">email</th>
            <th className="px-4 py-2 font-normal">region</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r[0]} className="border-t border-white/[0.07] text-white/80">
              <td className="px-4 py-2.5">{r[0]}</td>
              <td className="px-4 py-2.5 font-mono text-[12px] text-highlight">{r[1]}</td>
              <td className="px-4 py-2.5">{r[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="m-2 flex flex-col gap-2 rounded-[16px] border border-white/[0.07] bg-black/40 px-4 py-3 text-[12.5px] text-white/65">
        <li className="flex items-center gap-2"><ShieldCheck className="size-3.5 shrink-0 text-highlight" aria-hidden /> Ravi exported “Revenue by region” as CSV · 09:14</li>
        <li className="flex items-center gap-2"><Database className="size-3.5 shrink-0 text-highlight" aria-hidden /> Asha hid “phone” from viewers · 08:52</li>
        <li className="flex items-center gap-2"><Clock className="size-3.5 shrink-0 text-highlight" aria-hidden /> Pipeline “Daily revenue” read orders · 06:00</li>
      </ul>
    </div>
  );
}
