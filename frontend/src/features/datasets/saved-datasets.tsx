"use client";

import { formatDistanceToNow } from "date-fns";
import { ArrowRight, Database, FileSpreadsheet } from "lucide-react";
import Link from "next/link";

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

import { useDatasets } from "./api";
import { TypeBadge } from "./column-summary";

const nf = new Intl.NumberFormat("en-US");

/** Datasets saved in this workspace, newest first. Each card opens the dataset. */
export function SavedDatasets({ highlightId }: { highlightId?: string }) {
  const { data, isPending, isError } = useDatasets();

  return (
    <section aria-labelledby="saved-heading" className="flex flex-col gap-4">
      <h2 id="saved-heading" className="flex items-center gap-2 text-lg font-semibold">
        <Database className="size-[18px] text-highlight" strokeWidth={1.8} aria-hidden />
        Your datasets
        {!!data?.length && <span className="text-sm font-normal text-faint">{data.length}</span>}
      </h2>

      {isPending && (
        <ul className="grid gap-3 md:grid-cols-2" aria-busy>
          {[0, 1].map((i) => (
            <li key={i} className="h-[120px] animate-pulse rounded-[16px] bg-surface" />
          ))}
        </ul>
      )}
      {isError && <p className="text-sm text-accent">We couldn’t load your datasets. Refresh to try again.</p>}
      {data?.length === 0 && (
        <Empty className="border border-dashed border-line">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileSpreadsheet />
            </EmptyMedia>
            <EmptyTitle>No datasets yet</EmptyTitle>
            <EmptyDescription>Add a CSV or Excel file above and press Save dataset. It shows up here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {!!data?.length && (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.map((d) => {
            const shown = d.columns.slice(0, 4);
            return (
              <li key={d.id}>
                <Link
                  href={`/data/${d.id}`}
                  className={cn(
                    "group flex h-full flex-col gap-4 rounded-[16px] border border-line bg-surface p-5 transition-colors hover:border-primary/60",
                    d.id === highlightId && "border-primary bg-line/40",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <FileSpreadsheet className="mt-0.5 size-5 shrink-0 text-highlight" strokeWidth={1.6} aria-hidden />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-semibold">{d.name}</span>
                      <span className="truncate text-[13px] text-muted">
                        {nf.format(d.row_count)} rows · {d.columns.length} columns · {d.source_filename}
                        {d.sheet ? ` (${d.sheet})` : ""}
                      </span>
                    </div>
                    <ArrowRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-text" aria-hidden />
                  </div>
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5" aria-label="Column types">
                      {shown.map((c) => (
                        <TypeBadge key={c.name} type={c.type} />
                      ))}
                      {d.columns.length > shown.length && <span className="text-xs text-faint">+{d.columns.length - shown.length}</span>}
                    </div>
                    <time dateTime={d.updated_at ?? d.created_at} className="text-[12px] text-faint">
                      {formatDistanceToNow(new Date(d.updated_at ?? d.created_at), { addSuffix: true })}
                    </time>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
