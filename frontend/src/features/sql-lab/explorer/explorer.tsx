"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Blocks,
  Calendar,
  CalendarClock,
  ChevronRight,
  Database,
  ExternalLink,
  Eye,
  FileCode2,
  Hash,
  Link2,
  MoreHorizontal,
  Play,
  Search,
  Sigma,
  Tag,
  Trash2,
  Type,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { isApproved, metricSql, useMetrics } from "@/features/metrics/api";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

import { quoteIdent, type Column, type JoinHint, type Param, type Saved, type Table } from "../params";
import type { HistoryEntry } from "../use-lab-state";

type Side = "schema" | "saved" | "history";

const TYPE_ICON: Record<string, LucideIcon> = { number: Hash, date: Calendar, category: Tag, text: Type };
const CARDINALITY: Record<JoinHint["cardinality"], string> = {
  one_to_one: "one to one",
  one_to_many: "one to many",
  many_to_one: "many to one",
  many_to_many: "many to many",
};

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export type ExplorerProps = {
  schema: { isPending: boolean; data?: Table[] };
  saved?: Saved[];
  history: HistoryEntry[];
  activeSavedId: string | null;
  onInsert: (text: string) => void;
  /** Open SQL in a new tab; `run` also runs it straight away. */
  onOpenSql: (title: string, sql: string, run?: boolean) => void;
  onOpenSaved: (q: Saved) => void;
  onDeleteSaved: (id: string) => void;
  onOpenHistory: (h: { sql: string; params: Param[] }) => void;
  onClearHistory: () => void;
};

/** Left pane: the workspace's tables (with columns and detected relationships), saved queries and history. */
export function Explorer(props: ExplorerProps) {
  const [side, setSide] = useState<Side>("schema");
  const [filter, setFilter] = useState("");
  const tabs: { id: Side; label: string; count?: number }[] = [
    { id: "schema", label: "Schema", count: props.schema.data?.length },
    { id: "saved", label: "Saved", count: props.saved?.length },
    { id: "history", label: "History" },
  ];

  return (
    <TooltipProvider>
      <aside className="flex h-full min-h-0 flex-col gap-2.5 p-3" aria-label="Schema, saved queries and history">
        <div className="grid grid-cols-3 gap-1 rounded-[10px] border border-line bg-bg/60 p-0.5" role="tablist">
          {tabs.map(({ id, label, count }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={side === id}
              onClick={() => setSide(id)}
              className={cn(
                "flex min-h-8 min-w-0 items-center justify-center gap-1 rounded-[8px] px-1 text-[12.5px] font-medium transition-colors",
                side === id ? "bg-surface-2 text-text shadow-sm" : "text-muted hover:text-text",
              )}
            >
              {label}
              {count ? <span className="text-[10.5px] tabular-nums text-faint">{count}</span> : null}
            </button>
          ))}
        </div>

        {side !== "history" && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" aria-hidden />
            <Input
              aria-label={side === "schema" ? "Search tables and columns" : "Search saved queries"}
              placeholder={side === "schema" ? "Search tables and columns" : "Search saved queries"}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-8 pl-8 text-[13px]"
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5" data-lenis-prevent>
          {side === "schema" && <SchemaTree {...props} filter={filter.trim().toLowerCase()} />}
          {side === "schema" && <ApprovedMetrics filter={filter.trim().toLowerCase()} onOpenSql={props.onOpenSql} />}
          {side === "saved" && <SavedList {...props} filter={filter.trim().toLowerCase()} />}
          {side === "history" && <HistoryList {...props} />}
        </div>
      </aside>
    </TooltipProvider>
  );
}

/* ---------- approved metrics ---------- */

function ApprovedMetrics({ filter, onOpenSql }: { filter: string; onOpenSql: ExplorerProps["onOpenSql"] }) {
  const { data } = useMetrics();
  const [failed, setFailed] = useState<string | null>(null);
  const metrics = (data ?? []).filter((m) => isApproved(m) && m.name.toLowerCase().includes(filter));
  if (!metrics.length) return null;
  return (
    <section className="mt-3 border-t border-line pt-2" aria-label="Approved metrics">
      <p className="px-1.5 pb-1 text-[11.5px] font-medium text-faint">Approved metrics</p>
      <ul>
        {metrics.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              title={m.approved_formula ?? undefined}
              className="flex min-h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] hover:bg-surface-2"
              onClick={() => {
                setFailed(null);
                metricSql(m.id).then(({ sql }) => onOpenSql(m.name, sql, true), (e: Error) => setFailed(e.message));
              }}
            >
              <Sigma className="size-3.5 shrink-0 text-faint" />
              <span className="min-w-0 truncate">{m.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {failed && <p role="alert" className="px-1.5 pt-1 text-xs text-destructive">{failed}</p>}
    </section>
  );
}

/* ---------- schema ---------- */

function SchemaTree({ schema, filter, onInsert, onOpenSql }: ExplorerProps & { filter: string }) {
  if (schema.isPending)
    return (
      <div className="flex flex-col gap-2" aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded-lg bg-surface-2/70" />
        ))}
      </div>
    );
  if (!schema.data?.length)
    return (
      <p className="px-1 text-[13px] leading-relaxed text-faint">
        No datasets yet.{" "}
        <Link href="/data" className="text-highlight hover:underline">
          Add one on the Data page
        </Link>
        , then query it here.
      </p>
    );

  const tables = schema.data
    .map((t) => ({ t, cols: filter ? t.columns.filter((c) => c.name.toLowerCase().includes(filter)) : t.columns }))
    .filter(({ t, cols }) => !filter || t.table.includes(filter) || t.dataset_name.toLowerCase().includes(filter) || cols.length);

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-0.5">
        {tables.map(({ t, cols }) => (
          <TableNode key={t.table} table={t} columns={filter && !t.table.includes(filter) ? cols : t.columns} open={!!filter} onInsert={onInsert} onOpenSql={onOpenSql} />
        ))}
      </ul>
      {schema.data.length > 1 && <Relationships onOpenSql={onOpenSql} />}
    </div>
  );
}

function TableNode({
  table: t,
  columns,
  open,
  onInsert,
  onOpenSql,
}: {
  table: Table;
  columns: Column[];
  open: boolean;
  onInsert: (s: string) => void;
  onOpenSql: ExplorerProps["onOpenSql"];
}) {
  return (
    <li>
      <details className="group/table" open={open}>
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-md pl-1 pr-0.5 text-sm hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 shrink-0 text-faint transition-transform group-open/table:rotate-90" aria-hidden />
          <Database className="size-3.5 shrink-0 text-highlight" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-text" title={t.dataset_name}>
            {t.table}
          </span>
          <span className="shrink-0 text-[10.5px] tabular-nums text-faint">{t.row_count.toLocaleString()}</span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-xs" aria-label={`Actions for ${t.table}`} className="text-faint hover:text-text" onClick={(e) => e.stopPropagation()} />}
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => onOpenSql(t.table, `SELECT *\nFROM ${t.table}\nLIMIT 100`)}>
                <FileCode2 /> New query on this table
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onOpenSql(t.table, `SELECT *\nFROM ${t.table}\nLIMIT 100`, true)}>
                <Eye /> Preview 100 rows
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onInsert(t.table)}>
                <Play /> Insert table name
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href={`/data/${t.dataset_id}`} />}>
                <ExternalLink /> Open dataset
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </summary>
        <p className="truncate pb-1 pl-8 text-[11px] text-faint">{t.dataset_name}</p>
        <ul className="flex flex-col pb-1.5 pl-6">
          {columns.map((c) => (
            <ColumnNode key={c.name} column={c} onInsert={onInsert} />
          ))}
        </ul>
      </details>
    </li>
  );
}

function ColumnNode({ column: c, onInsert }: { column: Column; onInsert: (s: string) => void }) {
  const Icon = TYPE_ICON[c.type] ?? Type;
  return (
    <li>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => onInsert(quoteIdent(c.name))}
              className="flex min-h-7 w-full items-center gap-2 rounded px-1.5 text-left text-[12px] hover:bg-surface-2"
              aria-label={`Insert ${c.name} (${c.type})`}
            />
          }
        >
          <Icon className="size-3 shrink-0 text-faint" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-mono text-muted">{c.name}</span>
          {typeof c.empty_ratio === "number" && c.empty_ratio > 0.2 && (
            <span className="shrink-0 text-[10px] text-accent" title="Share of empty cells">
              {Math.round(c.empty_ratio * 100)}% empty
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-64">
          <p className="font-mono text-[12px]">{c.name}</p>
          <p className="text-[11.5px] opacity-80">
            {c.type}
            {typeof c.empty_ratio === "number" ? ` · ${Math.round(c.empty_ratio * 100)}% empty` : ""}
          </p>
          {c.examples?.length ? <p className="mt-1 text-[11.5px] opacity-80">e.g. {c.examples.slice(0, 3).join(", ")}</p> : null}
          <p className="mt-1 text-[11px] opacity-60">Click to insert</p>
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

function Relationships({ onOpenSql }: { onOpenSql: ExplorerProps["onOpenSql"] }) {
  const joins = useQuery({ queryKey: ["sql", "joins"], queryFn: () => api<JoinHint[]>("/sql/schema/joins"), staleTime: 60_000 });
  return (
    <section aria-labelledby="rel-heading" className="flex flex-col gap-2 border-t border-line pt-3">
      <h3 id="rel-heading" className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
        <Link2 className="size-3.5" aria-hidden /> Relationships
      </h3>
      {joins.isPending && <div className="h-14 animate-pulse rounded-lg bg-surface-2/70" />}
      {joins.isError && <p className="px-1 text-[12px] text-faint">Couldn&apos;t check relationships right now.</p>}
      {joins.data?.length === 0 && (
        <p className="px-1 text-[12px] leading-relaxed text-faint">No matching columns found between your datasets yet.</p>
      )}
      <ul className="flex flex-col gap-1.5">
        {joins.data?.map((j) => (
          <li key={`${j.left_table}.${j.left_column}-${j.right_table}.${j.right_column}`} className="rounded-lg border border-line bg-bg/50 p-2.5">
            <p className="flex flex-wrap items-center gap-1 font-mono text-[11.5px] text-text">
              <span>
                {j.left_table}.<span className="text-highlight">{j.left_column}</span>
              </span>
              <span className="text-faint">↔</span>
              <span>
                {j.right_table}.<span className="text-highlight">{j.right_column}</span>
              </span>
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-line" aria-hidden>
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(j.overlap * 100)}%` }} />
              </div>
              <span className="text-[10.5px] tabular-nums text-faint">{Math.round(j.overlap * 100)}% match</span>
            </div>
            <p className="mt-1 text-[10.5px] text-faint">
              {CARDINALITY[j.cardinality]}
              {j.normalized ? " · matches after ignoring case and spaces" : ""}
            </p>
            <Button
              variant="ghost"
              size="xs"
              className="mt-1 -ml-1.5 text-highlight"
              onClick={() => onOpenSql(`${j.left_table} + ${j.right_table}`, `SELECT *\n${j.sql}\nLIMIT 100`)}
            >
              Use this join
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- saved and history ---------- */

function SavedList({ saved, filter, activeSavedId, onOpenSaved, onDeleteSaved }: ExplorerProps & { filter: string }) {
  if (!saved?.length)
    return <p className="px-1 text-[13px] leading-relaxed text-faint">Save a query (Ctrl/⌘+S) to reuse it, export it, or share it with your team.</p>;
  return (
    <ul className="flex flex-col gap-0.5">
      {saved
        .filter((q) => !filter || q.name.toLowerCase().includes(filter) || q.sql.toLowerCase().includes(filter))
        .map((q) => (
          <li key={q.id} className={cn("group flex items-center gap-1 rounded-md px-1.5 py-1.5 hover:bg-surface-2", activeSavedId === q.id && "bg-surface-2")}>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpenSaved(q)}>
              <span className="block truncate text-[13px] text-text">{q.name}</span>
              <span className="block truncate font-mono text-[11px] text-faint">{q.sql.replace(/\s+/g, " ")}</span>
            </button>
            {q.schedule && (
              <span className="shrink-0 text-highlight" title={`Scheduled: ${q.schedule}`} aria-label={`Scheduled: ${q.schedule}`}>
                <CalendarClock className="size-3.5" />
              </span>
            )}
            {q.builder_state && (
              <span className="shrink-0 text-faint" title="Built with the visual builder" aria-label="Built with the visual builder">
                <Blocks className="size-3.5" />
              </span>
            )}
            {q.params.length > 0 && <span className="shrink-0 rounded bg-accent/15 px-1.5 text-[10px] text-accent">{q.params.length} param</span>}
            <Button variant="ghost" size="icon-xs" aria-label={`Delete ${q.name}`} className="opacity-60 group-hover:opacity-100" onClick={() => onDeleteSaved(q.id)}>
              <Trash2 />
            </Button>
          </li>
        ))}
    </ul>
  );
}

function HistoryList({ history, onOpenHistory, onClearHistory }: ExplorerProps) {
  if (!history.length) return <p className="px-1 text-[13px] leading-relaxed text-faint">Queries you run show up here, in this browser.</p>;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-0.5">
        {history.map((h) => (
          <li key={h.id}>
            <button type="button" onClick={() => onOpenHistory(h)} className="flex w-full flex-col gap-0.5 rounded-md px-1.5 py-1.5 text-left hover:bg-surface-2" title="Open in a new tab">
              <span className="line-clamp-2 font-mono text-[11.5px] text-text">{h.sql.replace(/\s+/g, " ")}</span>
              <span className={cn("text-[11px]", h.ok ? "text-faint" : "text-accent")}>
                {ago(h.at)} · {h.ok ? `${h.rows?.toLocaleString()} rows · ${h.ms} ms` : "failed"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Button variant="ghost" size="sm" className="self-start" onClick={onClearHistory}>
        <Trash2 /> Clear history
      </Button>
    </div>
  );
}
