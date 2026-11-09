"use client";

import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef } from "react";

import { TypeBadge } from "./column-summary";
import type { ColumnProfile, DataRow } from "./types";

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, DataRow>();

const ROW_HEIGHT = 36;
const COL_WIDTH = 180;
const INDEX_WIDTH = 56;

/** Virtualized preview: thousands of rows scroll smoothly; only visible rows are in the DOM. */
export function DataPreviewTable({ columns, rows }: { columns: ColumnProfile[]; rows: DataRow[] }) {
  const tableColumns = useMemo(
    () =>
      helper.columns(
        columns.map((c) =>
          helper.accessor((row) => row[c.name] ?? "", {
            id: c.name,
            header: () => (
              <span className="flex items-center gap-2">
                <span className="truncate">{c.name}</span>
                <TypeBadge type={c.type} />
              </span>
            ),
          }),
        ),
      ),
    [columns],
  );

  const table = useTable({ features, columns: tableColumns, data: rows });
  const tableRows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const width = INDEX_WIDTH + columns.length * COL_WIDTH;

  return (
    <div
      ref={scrollRef}
      data-lenis-prevent
      tabIndex={0}
      aria-label="Data preview, scrollable"
      className="h-[min(560px,65vh)] overflow-auto overscroll-contain rounded-[12px] border border-white/10 bg-black/40 font-mono text-[12.5px] focus-visible:outline-highlight"
    >
      <table className="grid border-collapse" style={{ width }}>
        <thead className="sticky top-0 z-10 grid bg-[#17132e]">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="flex">
              <th className="flex shrink-0 items-center justify-end px-3 text-white/35" style={{ width: INDEX_WIDTH, height: 40 }}>
                #
              </th>
              {group.headers.map((header) => (
                <th
                  key={header.id}
                  scope="col"
                  className="flex shrink-0 items-center border-l border-white/[0.06] px-3 text-left font-sans text-[13px] font-semibold text-white"
                  style={{ width: COL_WIDTH, height: 40 }}
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="relative grid" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = tableRows[item.index];
            return (
              <tr
                key={row.id}
                className="absolute flex w-full border-t border-white/[0.05] hover:bg-white/[0.04]"
                style={{ transform: `translateY(${item.start}px)`, height: ROW_HEIGHT }}
              >
                <td className="flex shrink-0 items-center justify-end px-3 text-white/30" style={{ width: INDEX_WIDTH }}>
                  {item.index + 1}
                </td>
                {row.getAllCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="flex shrink-0 items-center overflow-hidden border-l border-white/[0.05] px-3 text-white/80"
                    style={{ width: COL_WIDTH }}
                  >
                    <span className="truncate">
                      <table.FlexRender cell={cell} />
                    </span>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
