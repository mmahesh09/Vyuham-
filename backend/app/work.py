"""'Show the work' for an answer: the real query in plain words, the rows it used, and a total to check.

Everything here is read off the chart spec that was actually run (not off the parser's guesses), and
every count comes from the data, so an owner can check an answer against their own spreadsheet:
which rows were used, which were left out and why, and whether the bars add up to the total.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import duckdb

from app.models import Dataset
from app.query import ROW_KEY, Filters, _columns, _run, _where, metric_key, quote, view_name

TOTAL_AGGS = {"sum", "count"}  # aggregations whose per-group values add up to an overall total


def row_filters(spec: dict, dash: Filters | None) -> list[dict]:
    """The answer's filters in the rows endpoint's format, so 'See the rows' shows exactly these rows."""
    out = [dict(f) for f in spec.get("filters") or []]
    if dash and dash.date_field:
        if dash.date_from:
            out.append({"field": dash.date_field, "op": "gte", "value": dash.date_from.isoformat()})
        if dash.date_to:
            # Same bound as the chart query: the whole of the last day is included.
            out.append({"field": dash.date_field, "op": "lt", "value": (dash.date_to + timedelta(days=1)).isoformat()})
    return out


def _calculation(m: dict) -> str:
    agg, name = m.get("agg"), m.get("field")
    if agg == "metric":
        return f"Calculated the saved metric “{m.get('label') or name}”"
    if name == ROW_KEY:
        return "Counted the rows"
    return {
        "sum": f"Added up {name}",
        "avg": f"Averaged {name}",
        "min": f"Took the lowest {name}",
        "max": f"Took the highest {name}",
        "count": f"Counted the rows that have a {name}",
        "count_distinct": f"Counted the different values of {name}",
    }.get(agg, f"{agg} of {name}")


def _filter_step(f: dict) -> str:
    field, op, value = f.get("field"), f.get("op"), f.get("value")
    words = {
        "eq": f"is {value}",
        "neq": f"is not {value}",
        "gt": f"is more than {value}",
        "gte": f"is {value} or more",
        "lt": f"is less than {value}",
        "lte": f"is {value} or less",
        "contains": f"contains “{value}”",
        "empty": "is empty",
        "not_empty": "is not empty",
        "in": "is one of " + ", ".join(str(v) for v in value) if isinstance(value, list) else f"is {value}",
        "between": f"is between {value[0]} and {value[1]}" if isinstance(value, list) and len(value) == 2 else f"is {value}",
    }
    return f"Only rows where {field} {words.get(op, f'{op} {value}')}"


def _steps(spec: dict, dataset: Dataset, dash: Filters | None) -> list[str]:
    steps = [f"Read the data in {dataset.name}"]
    for f in spec.get("filters") or []:
        steps.append(_filter_step(f))
    if dash and dash.date_field and (dash.date_from or dash.date_to):
        lo = dash.date_from.isoformat() if dash.date_from else "the start"
        hi = dash.date_to.isoformat() if dash.date_to else "today"
        steps.append(f"Only rows where {dash.date_field} is from {lo} to {hi}")
    metrics = spec.get("metrics") or []
    if metrics:
        steps.append(_calculation(metrics[0]))
    group = spec.get("groupBy")
    if group:
        if spec.get("dateBucket"):
            steps.append(f"Grouped by {spec['dateBucket']} of {group}")
        else:
            steps.append(f"Grouped by {group}")
        if spec.get("limit") and not spec.get("dateBucket"):
            which = "bottom" if spec.get("sort") == "value_asc" else "top"
            steps.append(f"Kept the {which} {spec['limit']}")
    return steps


def _count_where(name: str) -> str:
    return f"COUNT(*) FILTER (WHERE {quote(name)} IS NULL)"


def answer_work(
    con: duckdb.DuckDBPyConnection, spec: dict, dataset: Dataset, dash: Filters | None, rows: list[dict]
) -> dict[str, Any]:
    """How an answer was worked out, with counts from the data. Plain dict, shaped like AskOut.work."""
    cols = _columns(dataset)
    filters = row_filters(spec, dash)
    metrics = spec.get("metrics") or []
    m = metrics[0] if metrics else {}
    agg, field = m.get("agg"), m.get("field")
    group = spec.get("groupBy") or None

    selects = ["COUNT(*)"]
    selects.append(_count_where(group) if group and group in cols else "0")
    has_field = field not in (None, ROW_KEY) and field in cols
    selects.append(_count_where(field) if has_field and agg != "metric" else "0")
    can_total = bool(group) and agg in TOTAL_AGGS and not spec.get("seriesBy") and (field == ROW_KEY or has_field)
    if can_total:
        expr = "COUNT(*)" if field == ROW_KEY else (f"SUM({quote(field)})" if agg == "sum" else f"COUNT({quote(field)})")
        # Rows with no group label aren't in any bar, so they're left out of the total the bars add up to.
        selects.append(f"{expr} FILTER (WHERE {quote(group)} IS NOT NULL)")
    else:
        selects.append("NULL")

    params: list[Any] = []
    where = _where(cols, filters, None, params)
    sql = f"SELECT {', '.join(selects)} FROM {view_name(dataset.id)}{where}"  # values are bound  # nosec B608
    used, no_group, no_value, total = _run(con, sql, params, op="work")[1][0]
    rows_total = _run(con, f"SELECT COUNT(*) FROM {view_name(dataset.id)}", [], op="work")[1][0][0]  # nosec B608

    left_out: list[str] = []
    if no_group:
        left_out.append(
            f"1 row has no {group}, so it isn’t in the chart."
            if no_group == 1
            else f"{no_group} rows have no {group}, so they aren’t in the chart."
        )
    if no_value and agg in ("sum", "avg", "min", "max"):
        left_out.append(
            f"1 row has no {field}, so it wasn’t counted."
            if no_value == 1
            else f"{no_value} rows have no {field}, so they weren’t counted."
        )

    check = None
    if can_total and total is not None:
        key = metric_key(m)
        shown = sum(float(r[key]) for r in rows if isinstance(r.get(key), (int, float)))
        check = {
            "metric": f"{'Rows' if field == ROW_KEY else field}",
            "shown": shown,
            "total": float(total),
            "groups_shown": len(rows),
            "limited": bool(spec.get("limit")),
        }

    return {
        "steps": _steps(spec, dataset, dash),
        "rows_used": int(used),
        "rows_total": int(rows_total),
        "left_out": left_out,
        "check": check,
        "row_filters": filters,
    }
