"""Column statistics for the data profiler: counts, blanks, distinct values, ranges, shape.

Computed in DuckDB over the dataset's typed view (so retyped and calculated columns are profiled as
the rest of the app sees them), and cached by the dataset's version: the numbers only change when
the data or its column types do.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

import duckdb

from app import cache
from app.models import Dataset
from app.query import QueryError, _parquet, _run, quote, view_name, view_signature

TOP_VALUES = 8
BINS = 12
MAX_DATE_BUCKETS = 36


def _plain(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, float) and v != v:  # NaN
        return None
    return v


def _column(con: duckdb.DuckDBPyConnection, view: str, col: dict, rows: int) -> dict:
    name, kind = col["name"], col.get("type", "text")
    c = quote(name)
    base = _run(
        con,
        f"SELECT COUNT({c}), approx_count_distinct({c}), MIN({c}), MAX({c}) FROM {view}",  # server-built names  # nosec B608
        [],
        op="profile",
    )[1][0]
    filled, distinct, lo, hi = int(base[0] or 0), int(base[1] or 0), base[2], base[3]
    out: dict[str, Any] = {
        "name": name,
        "type": kind,
        "filled": filled,
        "empty": rows - filled,
        "empty_ratio": round((rows - filled) / rows, 4) if rows else 0.0,
        # approx_count_distinct can overshoot on tiny tables; never more than the filled cells.
        "distinct": min(distinct, filled),
        "unique": filled > 0 and distinct >= filled,
        "min": _plain(lo),
        "max": _plain(hi),
    }
    if filled == 0:
        return out

    if kind == "number":
        mean, std, q1, med, q3 = _run(
            con,
            f"SELECT AVG({c}), STDDEV_SAMP({c}), approx_quantile({c}, 0.25), approx_quantile({c}, 0.5), approx_quantile({c}, 0.75) FROM {view}",  # nosec B608
            [],
            op="profile",
        )[1][0]
        out.update(mean=_plain(mean), std=_plain(std), q1=_plain(q1), median=_plain(med), q3=_plain(q3))
        lo_f, hi_f = float(lo), float(hi)
        if hi_f > lo_f:
            width = (hi_f - lo_f) / BINS
            counts = _run(
                con,
                f"SELECT LEAST(FLOOR(({c} - ?) / ?), ?)::INT AS b, COUNT(*) FROM {view} WHERE {c} IS NOT NULL GROUP BY 1 ORDER BY 1",  # nosec B608
                [lo_f, width, BINS - 1],
                op="profile",
            )[1]
            hist = [0] * BINS
            for b, n in counts:
                hist[max(0, min(BINS - 1, int(b)))] = int(n)
            out["histogram"] = [{"from": lo_f + i * width, "to": lo_f + (i + 1) * width, "count": n} for i, n in enumerate(hist)]
        else:
            out["histogram"] = [{"from": lo_f, "to": hi_f, "count": filled}]
        return out

    if kind == "date":
        span_days = (hi - lo).days if isinstance(hi, (date, datetime)) and isinstance(lo, (date, datetime)) else 0
        unit = "day" if span_days <= 62 else "week" if span_days <= 365 else "month" if span_days <= 365 * 3 else "year"
        counts = _run(
            con,
            f"SELECT date_trunc('{unit}', {c})::DATE AS b, COUNT(*) FROM {view} WHERE {c} IS NOT NULL GROUP BY 1 ORDER BY 1",  # nosec B608
            [],
            op="profile",
        )[1]
        out["timeline"] = {"unit": unit, "points": [{"at": _plain(b), "count": int(n)} for b, n in counts[-MAX_DATE_BUCKETS:]]}
        return out

    # category / text
    top = _run(
        con,
        f"SELECT CAST({c} AS VARCHAR) AS v, COUNT(*) AS n FROM {view} WHERE {c} IS NOT NULL GROUP BY 1 ORDER BY n DESC, v LIMIT {TOP_VALUES}",  # nosec B608
        [],
        op="profile",
    )[1]
    out["top"] = [{"value": v, "count": int(n)} for v, n in top]
    avg_len, max_len = _run(con, f"SELECT AVG(LENGTH(CAST({c} AS VARCHAR))), MAX(LENGTH(CAST({c} AS VARCHAR))) FROM {view}", [], op="profile")[1][0]  # nosec B608
    out.update(avg_length=round(float(avg_len or 0), 1), max_length=int(max_len or 0))
    return out


def profile_dataset(con: duckdb.DuckDBPyConnection, ds: Dataset) -> dict:
    """Every column's statistics plus table-level totals."""

    def compute() -> list[dict]:
        view = view_name(ds.id)
        try:
            rows = int(_run(con, f"SELECT COUNT(*) FROM {view}", [], op="profile")[1][0][0])  # nosec B608
            columns = [_column(con, view, col, rows) for col in ds.columns]
            dupes = int(_run(con, f"SELECT COUNT(*) - (SELECT COUNT(*) FROM (SELECT DISTINCT * FROM {view})) FROM {view}", [], op="profile")[1][0][0])  # nosec B608
        except duckdb.Error as e:
            raise QueryError("We couldn't profile this dataset.") from e
        cells = rows * len(columns)
        empty = sum(c["empty"] for c in columns)
        return [
            {
                "rows": rows,
                "columns": columns,
                "duplicate_rows": max(0, dupes),
                "completeness": round(1 - empty / cells, 4) if cells else 1.0,
            }
        ]

    k = cache.key("profile", ds.id, [c["name"] + ":" + c.get("type", "") for c in ds.columns], cache.dataset_version(ds, _parquet(ds)), view_signature(con, ds))
    return cache.cached(k, compute, "profile")[0]
