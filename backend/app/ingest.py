"""CSV/XLSX upload -> cleaned, typed DataFrame -> Parquet.

Type rules mirror frontend/src/features/datasets/infer-types.ts so the saved types match
what the user saw in the browser preview. One difference: a date column must parse with a
single format (so "03/04/2026" means the same thing in every row).
"""

from __future__ import annotations

import csv
import io
import math
import os
import re
from dataclasses import dataclass
from datetime import date, datetime, time
from pathlib import Path

import pandas as pd

SAMPLE = 500
CANDIDATE_DELIMITERS = ",;\t|"
NUMBER_RE = re.compile(r"^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?$")
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}([T ].*)?$")
# Tried in order; the first one that parses every value in the column wins.
DATE_FORMATS = ["ISO8601", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%d %b %Y", "%b %d, %Y", "%d.%m.%Y", "%Y/%m/%d"]


class IngestError(ValueError):
    """A problem with the file the user can fix; the message is shown to them as-is."""


@dataclass
class ColumnProfile:
    name: str
    type: str  # number | date | category | text
    empty_ratio: float
    examples: list[str]

    def as_dict(self) -> dict:
        return {"name": self.name, "type": self.type, "empty_ratio": self.empty_ratio, "examples": self.examples}


@dataclass
class IngestResult:
    frame: pd.DataFrame
    columns: list[ColumnProfile]
    sheets: list[str]
    sheet: str | None


# ---------- reading ----------


def _cell_text(v: object) -> str:
    """Excel cells arrive as numbers/dates/bools; turn everything into the text a user would see."""
    if v is None:
        return ""
    if isinstance(v, float):
        if math.isnan(v):
            return ""
        return str(int(v)) if v.is_integer() and abs(v) < 1e15 else repr(v)
    if isinstance(v, datetime):
        return v.date().isoformat() if v.time() == time() else v.isoformat(sep=" ")
    if isinstance(v, (date, time)):
        return v.isoformat()
    if v is pd.NaT:
        return ""
    return str(v).strip()


def clean_headers(raw: list[str]) -> list[str]:
    """Blank headers become "Column 3"; repeated headers get " (2)", " (3)"."""
    seen: dict[str, int] = {}
    out = []
    for i, h in enumerate(raw):
        base = h.strip() or f"Column {i + 1}"
        n = seen.get(base, 0) + 1
        seen[base] = n
        out.append(base if n == 1 else f"{base} ({n})")
    return out


def _decode(raw: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1")


def _read_csv(raw: bytes) -> pd.DataFrame:
    text = _decode(raw)
    if not text.strip():
        raise IngestError("This file is empty.")
    try:
        delimiter = csv.Sniffer().sniff(text[:65536], delimiters=CANDIDATE_DELIMITERS).delimiter
    except csv.Error:
        delimiter = ","
    try:
        return pd.read_csv(
            io.StringIO(text), sep=delimiter, header=None, dtype=str, keep_default_na=False, skip_blank_lines=True
        )
    except pd.errors.ParserError as e:
        line = re.search(r"line (\d+)", str(e))
        where = f" on line {line.group(1)}" if line else ""
        raise IngestError(f"A row{where} has more cells than the header row. Check for stray commas.") from e


def _read_xlsx(raw: bytes, sheet: str | None) -> tuple[pd.DataFrame, list[str], str]:
    try:
        book = pd.ExcelFile(io.BytesIO(raw), engine="openpyxl")
    except Exception as e:  # openpyxl raises many types for corrupt files
        raise IngestError("We couldn't open this Excel file. Is it a valid .xlsx?") from e
    sheets = [str(s) for s in book.sheet_names]
    if not sheets:
        raise IngestError("This workbook has no sheets.")
    chosen = sheet or sheets[0]
    if chosen not in sheets:
        raise IngestError(f'There is no sheet called "{chosen}" in this workbook.')
    frame = pd.read_excel(book, sheet_name=chosen, header=None, dtype=object)
    return frame, sheets, chosen


# ---------- typing ----------


def _normalise_number(v: str) -> str | None:
    s = re.sub(r"\s", "", v.strip())
    s = re.sub(r"^[$€£₹¥]", "", s)
    s = re.sub(r"%$", "", s)
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    return s if s and NUMBER_RE.match(s) and re.search(r"\d", s) else None


def _date_format(values: list[str]) -> str | None:
    if not values or any(not re.search(r"\d", v) or not 6 <= len(v.strip()) <= 30 for v in values):
        return None
    series = pd.Series(values)
    for fmt in DATE_FORMATS:
        if fmt == "ISO8601" and not all(ISO_DATE_RE.match(v.strip()) for v in values):
            continue
        parsed = pd.to_datetime(series.str.strip(), format=fmt, errors="coerce")
        if parsed.notna().all():
            return fmt
    return None


def _infer(sample: list[str], total_non_empty: int) -> tuple[str, str | None]:
    if not sample:
        return "text", None
    if all(_normalise_number(v) is not None for v in sample):
        return "number", None
    fmt = _date_format(sample)
    if fmt:
        return "date", fmt
    distinct = len({v.strip().lower() for v in sample})
    if total_non_empty >= 10 and (distinct <= 20 or distinct / len(sample) <= 0.2):
        return "category", None
    return "text", None


def _convert(values: pd.Series, kind: str, fmt: str | None) -> pd.Series:
    empty = values.str.strip() == ""
    if kind == "number":
        nums = pd.to_numeric(values.map(lambda v: (_normalise_number(v) or "").replace(",", "")), errors="coerce")
        nums[empty] = None
        whole = nums.dropna()
        if len(whole) and (whole % 1 == 0).all() and whole.abs().max() < 2**53:
            return nums.astype("Int64")
        return nums.astype("float64")
    if kind == "date":
        out = pd.to_datetime(values.str.strip().where(~empty), format=fmt, errors="coerce")
        return out
    return values.where(~empty, None).astype("string")


# ---------- entry point ----------


def ingest(raw: bytes, filename: str, sheet: str | None = None, max_rows: int = 1_000_000) -> IngestResult:
    ext = Path(filename).suffix.lower()
    if ext == ".csv":
        frame, sheets, chosen = _read_csv(raw), [], None
    elif ext == ".xlsx":
        frame, sheets, chosen = _read_xlsx(raw, sheet)
    else:
        raise IngestError("Use a .csv or .xlsx file.")

    text = frame.map(_cell_text) if len(frame) else frame.astype(str)
    if text.empty:
        raise IngestError("This sheet is empty.")

    headers = clean_headers(list(text.iloc[0]))
    body = text.iloc[1:].reset_index(drop=True)
    body.columns = headers

    # Drop rows with nothing in them, and phantom columns (no header, no values).
    body = body[(body != "").any(axis=1)].reset_index(drop=True)
    keep = [h for i, h in enumerate(headers) if text.iloc[0, i].strip() or (body[h] != "").any()]
    body = body[keep]

    if body.empty or not keep:
        raise IngestError("We found a header row but no data under it.")
    if len(body) > max_rows:
        raise IngestError(f"This file has {len(body):,} rows. The beta limit is {max_rows:,}.")

    profiles: list[ColumnProfile] = []
    typed: dict[str, pd.Series] = {}
    rows = len(body)
    for name in keep:
        col = body[name].astype(str)
        non_empty = col[col.str.strip() != ""]
        sample = non_empty.iloc[:SAMPLE].tolist()
        kind, fmt = _infer(sample, len(non_empty))
        typed[name] = _convert(col, kind, fmt)
        profiles.append(
            ColumnProfile(
                name=name,
                type=kind,
                empty_ratio=round(1 - len(non_empty) / rows, 4),
                examples=list(dict.fromkeys(sample))[:3],
            )
        )

    return IngestResult(frame=pd.DataFrame(typed), columns=profiles, sheets=sheets, sheet=chosen)


def write_parquet(frame: pd.DataFrame, path: Path) -> int:
    """Write atomically (temp file, then rename). Returns the file size in bytes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".parquet.tmp")
    frame.to_parquet(tmp, index=False)
    os.replace(tmp, path)
    return path.stat().st_size
