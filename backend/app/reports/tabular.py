"""CSV and Excel exports.

- Dashboard: one table per chart, exactly as the dashboard shows it (date range and filters
  applied). Excel gets a Summary sheet plus a sheet per chart; CSV is one file for a single
  chart, or a .zip with one CSV per chart.
- Saved query / dataset: every row, streamed from DuckDB in batches (no 5,000-row screen cap),
  up to REPORT_MAX_ROWS.

CSV files start with a UTF-8 byte-order mark so Excel opens non-English text correctly.
"""

from __future__ import annotations

import csv
import io
import math
import os
import re
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime

from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Font
from sqlalchemy.orm import Session

from app.config import get_settings
from app.insights import metric_label
from app.models import Dashboard, Dataset, SavedQuery
from app.query import QueryError, connect, metric_key, stream_rows, to_json, validate_select, view_name

XLSX_MAX_ROWS = 1_048_575  # Excel's limit, less the header row


@dataclass
class Table:
    title: str
    columns: list[str]
    rows: list[list]


@dataclass
class Built:
    path: str
    file_name: str
    rows: int


# ---------- dashboards ----------


def dashboard_tables(db: Session, d: Dashboard, date_from: date | None, date_to: date | None, equals: dict[str, str]) -> tuple[list[Table], list[str]]:
    """(one table per chart, the dashboard's headline sentences)."""
    from app.routers.dashboards import _view  # local import: the router imports app modules at load

    view = _view(db, d, date_from, date_to, equals)
    by_id = {c.id: c for c in view.charts}
    tables: list[Table] = []
    headlines: list[str] = []
    for c in d.charts:
        v = by_id.get(c.id)
        title = c.spec.get("title") or "Chart"
        if v is None or v.error:
            tables.append(Table(title, ["Problem"], [[v.error if v else "Not available"]]))
            continue
        if v.insight:
            headlines.append(v.insight.headline)
        labels = {metric_key(m): metric_label(m) for m in c.spec.get("metrics") or []}
        keys = list(v.rows[0].keys()) if v.rows else [*([c.spec["groupBy"]] if c.spec.get("groupBy") else []), *labels]
        tables.append(Table(title, [labels.get(k, k) for k in keys], [[r.get(k) for k in keys] for r in v.rows]))
    return tables, headlines


def safe_name(name: str, fallback: str = "export") -> str:
    cleaned = re.sub(r"[^\w\- ]+", "", name).strip().replace(" ", "-")
    return (cleaned or fallback)[:80]


def _write_csv(path: str, columns: list[str], batches: Iterable[Iterable]) -> int:
    n = 0
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(columns)
        for batch in batches:
            for row in batch:
                w.writerow(["" if v is None else to_json(v) for v in row])
                n += 1
    return n


def dashboard_csv(tables: list[Table], name: str, out_dir: str) -> Built:
    base = safe_name(name, "dashboard")
    if len(tables) == 1:
        path = os.path.join(out_dir, f"{base}.csv")
        rows = _write_csv(path, tables[0].columns, [tables[0].rows])
        return Built(path, f"{base}.csv", rows)
    path = os.path.join(out_dir, f"{base}.zip")
    total = 0
    used: set[str] = set()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for i, t in enumerate(tables, 1):
            fname = f"{i:02d}-{safe_name(t.title, 'chart')}.csv"
            while fname in used:
                fname = f"{i:02d}-{len(used)}-{safe_name(t.title, 'chart')}.csv"
            used.add(fname)
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(t.columns)
            for r in t.rows:
                w.writerow(["" if v is None else v for v in r])
            total += len(t.rows)
            z.writestr(fname, "﻿" + buf.getvalue())
    return Built(path, f"{base}.zip", total)


def _sheet_title(title: str, used: set[str]) -> str:
    base = re.sub(r"[\[\]:*?/\\]", "", title).strip()[:28] or "Sheet"
    name, i = base, 2
    while name.lower() in used:
        name = f"{base[:25]} ({i})"
        i += 1
    used.add(name.lower())
    return name


def _bold_row(ws, values: list) -> list:
    cells = []
    for v in values:
        c = WriteOnlyCell(ws, value=v)
        c.font = Font(bold=True)
        cells.append(c)
    return cells


def dashboard_xlsx(tables: list[Table], headlines: list[str], name: str, period: str, out_dir: str) -> Built:
    wb = Workbook(write_only=True)
    used: set[str] = set()
    summary = wb.create_sheet(_sheet_title("Summary", used))
    summary.append(_bold_row(summary, [name]))
    summary.append(["Period", period])
    summary.append(["Generated", datetime.now().strftime("%Y-%m-%d %H:%M")])
    summary.append([])
    if headlines:
        summary.append(_bold_row(summary, ["What stands out"]))
        for h in headlines:
            summary.append([h])
    total = 0
    for t in tables:
        ws = wb.create_sheet(_sheet_title(t.title, used))
        ws.append(_bold_row(ws, t.columns))
        for r in t.rows:
            ws.append(r)
        total += len(t.rows)
    base = safe_name(name, "dashboard")
    path = os.path.join(out_dir, f"{base}.xlsx")
    wb.save(path)
    return Built(path, f"{base}.xlsx", total)


# ---------- saved queries and datasets ----------


def _excel_value(v):
    if isinstance(v, datetime):
        return v.replace(tzinfo=None)  # Excel has no time zones
    if v is None or isinstance(v, (date, bool, int, str)):
        return v
    if isinstance(v, float):
        return None if math.isnan(v) or math.isinf(v) else v
    return to_json(v)  # Decimal -> float, anything else -> text


def _query_source(db: Session, source: str, source_id: str, workspace_id: str) -> tuple[str, list[Dataset], str]:
    """(sql, datasets to expose, name) for a saved query or dataset in this workspace."""
    from sqlalchemy import select

    datasets = list(db.scalars(select(Dataset).where(Dataset.workspace_id == workspace_id)))
    if source == "saved_query":
        q = db.get(SavedQuery, source_id)
        if q is None or q.workspace_id != workspace_id:
            raise QueryError("The saved query behind this report was deleted.")
        validate_select(q.sql)
        return q.sql, datasets, q.name
    ds = next((d for d in datasets if d.id == source_id), None)
    if ds is None:
        raise QueryError("The dataset behind this report was deleted.")
    return f"SELECT * FROM {view_name(ds.id)}", [ds], ds.name


def query_export(db: Session, source: str, source_id: str, workspace_id: str, fmt: str, out_dir: str, name: str | None = None) -> Built:
    sql, datasets, default_name = _query_source(db, source, source_id, workspace_id)
    base = safe_name(name or default_name)
    cap = get_settings().report_max_rows
    con = connect(workspace_id, datasets)
    try:
        if fmt == "csv":
            columns, batches = stream_rows(con, sql, max_rows=cap)
            path = os.path.join(out_dir, f"{base}.csv")
            return Built(path, f"{base}.csv", _write_csv(path, columns, batches))
        columns, batches = stream_rows(con, sql, max_rows=min(cap, XLSX_MAX_ROWS))
        wb = Workbook(write_only=True)
        ws = wb.create_sheet(_sheet_title(default_name, set()))
        ws.append(_bold_row(ws, columns))
        n = 0
        for batch in batches:
            for row in batch:
                ws.append([_excel_value(v) for v in row])
                n += 1
        path = os.path.join(out_dir, f"{base}.xlsx")
        wb.save(path)
        return Built(path, f"{base}.xlsx", n)
    finally:
        con.close()
