import { Link2 } from "lucide-react";

const COLUMNS = [
  { name: "order_date", role: "Date", text: "Day the order was placed" },
  { name: "customer", role: "Category", text: "Client company that ordered" },
  { name: "amount", role: "Metric", text: "Order value in USD, before tax" },
  { name: "status", role: "Category", text: "Only “Paid” counts as revenue" },
];

/** What the AI understood about an uploaded file. Sample data. */
export function ColumnsShot() {
  return (
    <div className="glass-strong rounded-[26px] p-2">
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <span className="text-sm font-medium text-white">sales_2026.xlsx</span>
        <span className="text-xs text-white/50">2,340 rows · read in 3s</span>
      </div>
      <ul className="flex flex-col">
        {COLUMNS.map((c) => (
          <li
            key={c.name}
            className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-x-4 gap-y-1 border-t border-white/[0.07] px-4 py-4 sm:grid-cols-[8rem_5.5rem_minmax(0,1fr)]"
          >
            <code className="truncate font-mono text-[13px] text-white">{c.name}</code>
            <span
              className={`w-fit rounded-[4px] px-2 py-0.5 text-xs font-semibold ${
                c.role === "Metric" ? "bg-accent text-[#14051b]" : "bg-white/10 text-highlight"
              }`}
            >
              {c.role}
            </span>
            <span className="col-span-2 text-sm text-white/65 sm:col-span-1">{c.text}</span>
          </li>
        ))}
      </ul>
      <div className="m-2 flex items-center gap-2 rounded-[16px] border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-white">
        <Link2 className="size-4 shrink-0 text-highlight" strokeWidth={2} aria-hidden />
        <span>
          <span className="font-semibold text-highlight">Link found:</span> customer ↔ clients.csv
        </span>
      </div>
    </div>
  );
}
