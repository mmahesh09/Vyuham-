import Papa from "papaparse";
import * as XLSX from "xlsx";

import { cleanHeaders, profileColumns } from "../infer-types";
import { PREVIEW_ROWS, type DataRow, type ParseResult } from "../types";

function toRows(headers: string[], matrix: unknown[][]): DataRow[] {
  return matrix.map((cells) => {
    const row: DataRow = {};
    headers.forEach((h, i) => {
      const v = cells[i];
      row[h] = v === null || v === undefined ? "" : String(v);
    });
    return row;
  });
}

async function parseCsv(file: File): Promise<ParseResult> {
  const text = await file.text();
  const matrix: string[][] = [];
  let header: string[] | null = null;
  let total = 0;

  // Count every row, keep only the preview.
  Papa.parse<string[]>(text, {
    skipEmptyLines: "greedy",
    step: ({ data }) => {
      if (!header) {
        header = data;
        return;
      }
      total += 1;
      if (matrix.length < PREVIEW_ROWS) matrix.push(data);
    },
  });

  if (!header) throw new Error("This file looks empty.");
  const columns = cleanHeaders(header);
  const rows = toRows(columns, matrix);
  return { fileName: file.name, kind: "csv", sheets: [], activeSheet: null, columns: profileColumns(columns, rows), rows, totalRows: total };
}

async function parseXlsx(file: File, sheet?: string): Promise<ParseResult> {
  // Values only: no formulas, no HTML, and never more than the preview is materialised.
  const wb = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    dense: true,
    cellFormula: false,
    cellHTML: false,
    cellDates: true,
    sheetRows: PREVIEW_ROWS + 1,
  });
  if (wb.SheetNames.length === 0) throw new Error("This workbook has no sheets.");
  const activeSheet = sheet && wb.SheetNames.includes(sheet) ? sheet : wb.SheetNames[0];
  const ws = wb.Sheets[activeSheet];

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "", blankrows: false, dateNF: "yyyy-mm-dd" });
  if (matrix.length === 0) throw new Error(`The sheet “${activeSheet}” is empty.`);

  const columns = cleanHeaders(matrix[0].map(String));
  const rows = toRows(columns, matrix.slice(1));
  // With sheetRows set, !fullref still describes the whole sheet.
  const fullRef = (ws["!fullref"] as string | undefined) ?? (ws["!ref"] as string | undefined);
  const totalRows = fullRef ? Math.max(0, XLSX.utils.decode_range(fullRef).e.r) : rows.length;

  return { fileName: file.name, kind: "xlsx", sheets: wb.SheetNames, activeSheet, columns: profileColumns(columns, rows), rows, totalRows };
}

export function parseFile(file: File, sheet?: string): Promise<ParseResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return parseCsv(file);
  if (name.endsWith(".xlsx")) return parseXlsx(file, sheet);
  return Promise.reject(new Error("Use a .csv or .xlsx file."));
}
