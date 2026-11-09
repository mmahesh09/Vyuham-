"use client";

import { useTable, type ColumnDef, type PaginationState, type SortingState } from "@tanstack/react-table";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DataGrid, dataGridFeatures, type DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { useDatasetRows, type Dataset, type DatasetRow } from "./api";

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function Cell({ value, type }: { value: DatasetRow[string]; type: string }) {
  if (value === null || value === "") return <span className="text-faint">—</span>;
  if (type === "number" && typeof value === "number") return <span className="block text-right tabular-nums">{nf.format(value)}</span>;
  return <span className="block max-w-[28ch] truncate" title={String(value)}>{String(value)}</span>;
}

/** Every row of a saved dataset, paged, sorted and searched on the server (DuckDB). */
export function DatasetGrid({ dataset }: { dataset: Dataset }) {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const [sorting, setSorting] = useState<SortingState>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  // Debounce typing into one request, and go back to page 1 for the new result set.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }));
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const sort = sorting[0];
  const { data, isFetching, isError, error } = useDatasetRows(dataset.id, {
    page: pagination.pageIndex,
    size: pagination.pageSize,
    sort: sort?.id,
    direction: sort?.desc ? "desc" : "asc",
    q: search,
  });

  const columns = useMemo<ColumnDef<DataGridFeatures, DatasetRow>[]>(
    () =>
      dataset.columns.map((c) => ({
        id: c.name,
        accessorFn: (row: DatasetRow) => row[c.name],
        header: ({ column }) => <DataGridColumnHeader title={c.name} column={column} />,
        cell: ({ row }) => <Cell value={row.original[c.name]} type={c.type} />,
        size: c.type === "number" ? 130 : c.type === "date" ? 140 : 180,
        enableSorting: true,
        meta: { skeleton: <Skeleton className="h-4 w-20" /> },
      })),
    [dataset.columns],
  );

  const total = data?.total ?? 0;
  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: data?.rows ?? [],
    manualPagination: true,
    manualSorting: true,
    rowCount: total,
    getRowId: (_row: DatasetRow, index: number) => String(pagination.pageIndex * pagination.pageSize + index),
    state: { pagination, sorting },
    onPaginationChange: setPagination,
    onSortingChange: (updater) => {
      setSorting(updater);
      setPagination((p) => ({ ...p, pageIndex: 0 }));
    },
  });

  return (
    <DataGrid table={table} recordCount={total} isLoading={!data && isFetching} tableLayout={{ columnsResizable: true }}>
      <div className="flex flex-col gap-3 rounded-[16px] border border-line bg-surface py-3">
        <div className="flex flex-wrap items-center justify-between gap-3 px-3.5">
          <p className="text-sm text-muted" aria-live="polite">
            {search ? `${nf.format(total)} matching rows` : `${nf.format(total)} rows`}
          </p>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search every column…"
              aria-label="Search rows"
              className="pl-8"
            />
            {searchInput && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="absolute right-1.5 top-1/2 -translate-y-1/2"
                aria-label="Clear search"
                onClick={() => {
                  setSearchInput("");
                  setSearch("");
                }}
              >
                <X />
              </Button>
            )}
          </div>
        </div>
        {isError ? (
          <p role="alert" className="px-3.5 py-6 text-sm text-accent">
            {error.message}
          </p>
        ) : (
          <div className={cn("border-t border-line transition-opacity", isFetching && data && "opacity-70")}>
            <DataGridScrollArea>
              <DataGridTable />
            </DataGridScrollArea>
          </div>
        )}
        <div className="px-3.5">
          <DataGridPagination />
        </div>
      </div>
    </DataGrid>
  );
}
