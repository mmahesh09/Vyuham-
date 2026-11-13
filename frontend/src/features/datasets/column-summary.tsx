import { cn } from "@/lib/utils";

import type { ColumnProfile, ColumnType } from "./types";

const TYPE_STYLE: Record<ColumnType, string> = {
  number: "bg-accent text-[#14051b]",
  date: "bg-primary text-text",
  category: "bg-white/10 text-highlight",
  text: "bg-white/[0.06] text-muted",
};
const TYPE_LABEL: Record<ColumnType, string> = { number: "Number", date: "Date", category: "Category", text: "Text" };

export function TypeBadge({ type }: { type: ColumnType }) {
  return <span className={cn("rounded-[4px] px-2 py-0.5 text-xs font-semibold", TYPE_STYLE[type])}>{TYPE_LABEL[type]}</span>;
}

/** What we detected about each column: type, how often it's empty, a few examples. */
export function ColumnSummary({ columns }: { columns: ColumnProfile[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {columns.map((c) => (
        <li key={c.name} className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <code className="truncate font-mono text-[13px] text-text">{c.name}</code>
            <TypeBadge type={c.type} />
          </div>
          <p className="truncate text-[13px] text-muted">{c.examples.length ? c.examples.join(" · ") : "No values in preview"}</p>
          {c.emptyRatio > 0.2 && (
            <p className="text-xs text-accent">{Math.round(c.emptyRatio * 100)}% of cells are empty</p>
          )}
        </li>
      ))}
    </ul>
  );
}
