"use client";

import { formatDistanceToNow } from "date-fns";
import { FileSpreadsheet } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { InlineAlert } from "@/components/app/inline-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { useDatasets } from "./api";
import { TypeBadge } from "./column-summary";

const nf = new Intl.NumberFormat("en-US");

/** Datasets saved in this workspace, newest first, as a table. Each row opens the dataset. */
export function SavedDatasets({ highlightId }: { highlightId?: string }) {
  const { data, isPending, isError } = useDatasets();

  return (
    <section aria-labelledby="saved-heading" className="flex flex-col gap-3">
      <h2 id="saved-heading" className="type-section flex items-baseline gap-2">
        Your datasets
        {!!data?.length && <span className="text-[13px] font-normal text-faint">{data.length}</span>}
      </h2>

      {isPending && (
        <div className="flex flex-col gap-2" aria-busy>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      )}
      {isError && <InlineAlert>We couldn’t load your datasets. Refresh the page to try again.</InlineAlert>}
      {data?.length === 0 && (
        <EmptyState
          icon={<FileSpreadsheet />}
          title="No datasets yet"
          description="Add a CSV or Excel file above and press Save dataset. It shows up here."
        />
      )}

      {!!data?.length && (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="border-line hover:bg-transparent">
                <TableHead className="h-10 pl-5 text-[12.5px] font-medium text-faint">Name</TableHead>
                <TableHead className="h-10 text-right text-[12.5px] font-medium text-faint">Rows</TableHead>
                <TableHead className="h-10 text-right text-[12.5px] font-medium text-faint max-md:hidden">Columns</TableHead>
                <TableHead className="h-10 text-[12.5px] font-medium text-faint max-lg:hidden">Column types</TableHead>
                <TableHead className="h-10 pr-5 text-right text-[12.5px] font-medium text-faint max-sm:hidden">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((d) => {
                const shown = d.columns.slice(0, 4);
                const when = d.updated_at ?? d.created_at;
                return (
                  <TableRow
                    key={d.id}
                    className={cn("relative border-line transition-colors hover:bg-surface-2/70", d.id === highlightId && "bg-line/50")}
                  >
                    <TableCell className="max-w-0 py-3 pl-5">
                      {/* The name link stretches over the whole row, so any part of it opens the dataset. */}
                      <Link
                        href={`/data/${d.id}`}
                        className="flex min-w-0 items-center gap-3 after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-highlight"
                      >
                        <FileSpreadsheet className="size-4 shrink-0 text-faint" strokeWidth={1.8} aria-hidden />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-[14.5px] font-medium text-text">{d.name}</span>
                          <span className="truncate text-[12.5px] text-faint">
                            {d.source_filename}
                            {d.sheet ? ` (${d.sheet})` : ""}
                          </span>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted">{nf.format(d.row_count)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted max-md:hidden">{d.columns.length}</TableCell>
                    <TableCell className="max-lg:hidden">
                      <div className="flex flex-wrap items-center gap-1.5" aria-label="Column types">
                        {shown.map((c) => (
                          <TypeBadge key={c.name} type={c.type} />
                        ))}
                        {d.columns.length > shown.length && <span className="text-xs text-faint">+{d.columns.length - shown.length}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="pr-5 text-right text-[13px] text-faint max-sm:hidden">
                      <time dateTime={when}>{formatDistanceToNow(new Date(when), { addSuffix: true })}</time>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
