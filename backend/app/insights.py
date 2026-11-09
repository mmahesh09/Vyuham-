"""Plain-English insights computed from query results (no AI yet), and starter dashboards.

Every number in a sentence comes from DuckDB. The AI round will only rewrite the wording.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta

import duckdb

from app.models import Dataset
from app.query import ROW_KEY, Filters, metric_key, quote, run_spec, view_name

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@dataclass
class Insight:
    headline: str
    trend: str  # up | down | flat
    note: str
    # For KPI tiles: the number, the previous period's number and the % change (when there is a period).
    value: float | None = None
    previous: float | None = None
    change: float | None = None


def compact(v: float | None) -> str:
    if v is None:
        return "—"
    a = abs(v)
    for size, suffix in ((1e9, "B"), (1e6, "M"), (1e3, "k")):
        if a >= size:
            s = f"{v / size:.1f}".rstrip("0").rstrip(".")
            return f"{s}{suffix}"
    return f"{v:,.2f}".rstrip("0").rstrip(".") if not float(v).is_integer() else f"{int(v):,}"


def pct_change(cur: float | None, prev: float | None) -> float | None:
    if cur is None or prev in (None, 0):
        return None
    return (cur - prev) / abs(prev) * 100


def trend_of(change: float | None) -> str:
    if change is None or abs(change) < 1:
        return "flat"
    return "up" if change > 0 else "down"


def metric_label(m: dict) -> str:
    if m.get("field") == ROW_KEY:
        return "Rows"
    name = m["field"]
    return {
        "sum": f"Total {name}",
        "avg": f"Average {name}",
        "min": f"Lowest {name}",
        "max": f"Highest {name}",
        "count": f"{name} count",
        "count_distinct": f"Unique {name}",
    }.get(m["agg"], name)


def bucket_label(label: str) -> str:
    """'2026-10' -> 'Oct 2026', '2026-Q3' stays, '2026-10-05' -> 'Oct 5'."""
    m = re.fullmatch(r"(\d{4})-(\d{2})", label)
    if m:
        return f"{MONTHS[int(m[2]) - 1]} {m[1]}"
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", label)
    if m:
        return f"{MONTHS[int(m[2]) - 1]} {int(m[3])}"
    return label


def previous_period(f: Filters | None) -> Filters | None:
    """The equal-length window right before the selected one, or None without a date range."""
    if not f or not f.date_field or not f.date_from or not f.date_to:
        return None
    days = (f.date_to - f.date_from).days + 1
    return Filters(f.date_field, f.date_from - timedelta(days=days), f.date_from - timedelta(days=1), dict(f.equals))


def is_current_bucket(label: str, bucket: str, today: date) -> bool:
    """Whether a bucket label from compile_spec ("2026-11", "2026-Q4", "2026", "2026-11-02") contains today."""
    if bucket == "year":
        return label == f"{today.year}"
    if bucket == "quarter":
        return label == f"{today.year}-Q{(today.month - 1) // 3 + 1}"
    if bucket == "month":
        return label == f"{today.year}-{today.month:02d}"
    if bucket == "week":
        monday = today - timedelta(days=today.weekday())
        return label == monday.isoformat()
    return label == today.isoformat()


def describe(
    spec: dict,
    rows: list[dict],
    prev_rows: list[dict] | None,
    dataset: Dataset,
    has_period: bool,
    today: date | None = None,
) -> Insight:
    metrics = spec.get("metrics") or []
    if not metrics:
        return Insight(spec.get("title", ""), "flat", "")
    m0 = metrics[0]
    key, label = metric_key(m0), metric_label(m0)
    group = spec.get("groupBy")
    types = {c["name"]: c["type"] for c in dataset.columns}

    if not rows or all(r.get(key) is None for r in rows):
        return Insight(f"No data for {label.lower()} with these filters", "flat", "Try a wider date range or clear a filter.")

    # KPI / single number
    if not group:
        cur = rows[0].get(key)
        prev = prev_rows[0].get(key) if prev_rows else None
        change = pct_change(cur, prev)
        if change is None:
            note = "Pick a date range to compare with the previous period." if not has_period else "Nothing to compare in the previous period."
            return Insight(f"{label}: {compact(cur)}", "flat", note, value=cur, previous=prev)
        word = "up" if change > 0 else "down"
        return Insight(
            f"{label} {word} {abs(change):.0f}% to {compact(cur)}", trend_of(change), f"Previous period: {compact(prev)}",
            value=cur, previous=prev, change=round(change, 2),
        )

    values = [r.get(key) or 0 for r in rows]
    total = sum(values)

    # Over time: compare the selected period with the one before, else the last two buckets.
    if types.get(group) == "date":
        if has_period and prev_rows is not None:
            prev_total = sum((r.get(key) or 0) for r in prev_rows)
            change = pct_change(total, prev_total)
            if change is not None and m0["agg"] in ("sum", "count", "count_distinct"):
                word = "up" if change > 0 else "down"
                return Insight(
                    f"{label} {word} {abs(change):.0f}% vs the previous period",
                    trend_of(change),
                    f"{compact(total)} now, {compact(prev_total)} before",
                )
        # The current week/month/quarter/year isn't over yet: comparing it with a full one
        # would always look like a drop, so compare the last two complete buckets instead.
        series = rows
        partial = len(rows) >= 3 and is_current_bucket(str(rows[-1][group]), spec.get("dateBucket") or "month", today or date.today())
        if partial:
            series = rows[:-1]
        if len(series) >= 2:
            last, before = series[-1], series[-2]
            change = pct_change(last.get(key), before.get(key))
            if change is not None:
                word = "up" if change > 0 else "down"
                so_far = f" · {bucket_label(str(rows[-1][group]))} so far: {compact(rows[-1].get(key))}" if partial else ""
                return Insight(
                    f"{label} {word} {abs(change):.0f}% in {bucket_label(str(last[group]))}",
                    trend_of(change),
                    f"vs {bucket_label(str(before[group]))} ({compact(before.get(key))} → {compact(last.get(key))}){so_far}",
                )
        return Insight(f"{label}: {compact(values[-1])} in {bucket_label(str(rows[-1][group]))}", "flat", "")

    # By category: who leads, and how concentrated it is.
    top = max(rows, key=lambda r: r.get(key) or 0)
    top_v = top.get(key) or 0
    if m0["agg"] in ("sum", "count", "count_distinct") and total > 0:
        share = top_v / total * 100
        risky = share >= 40 and len(rows) >= 3
        return Insight(
            f"{top[group]} leads with {share:.0f}% of {label.lower()}",
            "down" if risky else "flat",
            "A lot depends on one group" if risky else f"{compact(top_v)} of {compact(total)} across {len(rows)} groups",
        )
    return Insight(f"{top[group]} has the highest {label.lower()}: {compact(top_v)}", "flat", f"Across {len(rows)} groups")


def chart_insight(
    con: duckdb.DuckDBPyConnection, spec: dict, dataset: Dataset, filters: Filters | None
) -> tuple[list[dict], Insight]:
    rows = run_spec(con, spec, dataset, filters)
    prev = None if spec.get("sql") else previous_period(filters)  # SQL charts ignore dashboard filters
    prev_rows = run_spec(con, spec, dataset, prev) if prev else None
    return rows, describe(spec, rows, prev_rows, dataset, has_period=prev is not None)


# ---------- starter dashboards ----------

AMOUNT_HINT = re.compile(r"revenue|amount|sales|total|price|value|income|cost|spend|profit|mrr", re.I)
ENTITY_HINT = re.compile(r"client|customer|user|account|company|buyer|member", re.I)
ID_HINT = re.compile(r"(^|[^a-z])id$|_id$|^id[^a-z]|number$|^no\.?$|phone|zip|postcode|pin", re.I)


def _distinct_count(con: duckdb.DuckDBPyConnection, dataset: Dataset, col: str) -> int:
    return con.execute(f"SELECT COUNT(DISTINCT {quote(col)}) FROM {view_name(dataset.id)}").fetchone()[0]


def _date_span(con: duckdb.DuckDBPyConnection, dataset: Dataset, col: str) -> tuple[date | None, date | None]:
    lo, hi = con.execute(f"SELECT MIN({quote(col)}), MAX({quote(col)}) FROM {view_name(dataset.id)}").fetchone()
    return (lo.date() if lo else None, hi.date() if hi else None)


def starter_specs(con: duckdb.DuckDBPyConnection, dataset: Dataset) -> tuple[list[dict], dict, list[str]]:
    """Pick 4–8 charts from the column types. Returns (charts, date_fields, filter_columns)."""
    numbers = [c["name"] for c in dataset.columns if c["type"] == "number" and not ID_HINT.search(c["name"])]
    dates = [c["name"] for c in dataset.columns if c["type"] == "date"]
    # Small files often get "text" for what is really a category, so count those too.
    candidates = [c["name"] for c in dataset.columns if c["type"] in ("category", "text") and not ID_HINT.search(c["name"])]
    card = {c: _distinct_count(con, dataset, c) for c in candidates}
    cats = [c for c in candidates if next(col["type"] for col in dataset.columns if col["name"] == c) == "category" or card[c] <= 30]
    ds = dataset.id

    metric = next((n for n in numbers if AMOUNT_HINT.search(n)), numbers[0] if numbers else None)
    m = {"field": metric, "agg": "sum"} if metric else {"field": ROW_KEY, "agg": "count"}
    label = metric_label(m)

    def spec(title: str, chart_type: str, metrics: list[dict], **kw) -> dict:
        return {"dataset": ds, "metrics": metrics, "chartType": chart_type, "title": title, "filters": [], **kw}

    charts: list[dict] = []
    # KPIs
    charts.append({"kind": "kpi", "spec": spec(label, "kpi", [m])})
    charts.append({"kind": "kpi", "spec": spec("Rows", "kpi", [{"field": ROW_KEY, "agg": "count"}])})
    if metric:
        charts.append({"kind": "kpi", "spec": spec(f"Average {metric}", "kpi", [{"field": metric, "agg": "avg"}])})
    entity = next((c for c in cats if ENTITY_HINT.search(c)), None)
    if entity:
        charts.append({"kind": "kpi", "spec": spec(f"Unique {entity}", "kpi", [{"field": entity, "agg": "count_distinct"}])})

    # Trend
    date_fields: dict = {}
    if dates:
        d = dates[0]
        date_fields[ds] = d
        lo, hi = _date_span(con, dataset, d)
        span = (hi - lo).days if lo and hi else 0
        bucket = "month" if span > 180 else "week" if span > 45 else "day"
        charts.append({"kind": "card", "spec": spec(f"{label} over time", "line", [m], groupBy=d, dateBucket=bucket)})

    # Top groups: prefer readable dimensions (2–30 values)
    groupable = sorted((c for c in cats if 2 <= card[c] <= 30), key=lambda c: (not ENTITY_HINT.search(c), card[c]))
    for c in groupable[:2]:
        charts.append({"kind": "card", "spec": spec(f"{label} by {c}", "bar", [m], groupBy=c, limit=10)})
    small = next((c for c in cats if 2 <= card[c] <= 6 and c not in groupable[:2]), None)
    if small:
        charts.append({"kind": "card", "spec": spec(f"Share by {small}", "pie", [m], groupBy=small)})
    if not any(ch["kind"] == "card" for ch in charts) and entity:
        charts.append({"kind": "card", "spec": spec(f"Top {entity}", "bar", [m], groupBy=entity, limit=10)})

    filters = [c for c in sorted(cats, key=lambda c: card[c]) if 2 <= card[c] <= 50][:2]
    return charts, date_fields, filters
