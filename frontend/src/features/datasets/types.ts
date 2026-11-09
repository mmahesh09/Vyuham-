export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const PREVIEW_ROWS = 5000;
export const ACCEPTED = [".csv", ".xlsx"] as const;

export type ColumnType = "number" | "date" | "category" | "text";

export type ColumnProfile = {
  name: string;
  type: ColumnType;
  /** Share of empty cells in the preview, 0–1. */
  emptyRatio: number;
  examples: string[];
};

export type DataRow = Record<string, string>;

export type ParseResult = {
  fileName: string;
  kind: "csv" | "xlsx";
  /** Sheet names (xlsx only; empty for csv). */
  sheets: string[];
  activeSheet: string | null;
  columns: ColumnProfile[];
  rows: DataRow[];
  /** Rows in the whole file/sheet, which can exceed the preview. */
  totalRows: number;
};

export type ParseRequest = { id: number; file: File; sheet?: string };
export type ParseResponse = { id: number } & ({ ok: true; result: ParseResult } | { ok: false; error: string });
