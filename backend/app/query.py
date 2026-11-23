"""DuckDB query engine over a workspace's Parquet files.

Every request opens a fresh in-memory DuckDB that can read only the workspace's own folder:
`allowed_directories` is set, then external access is switched off and the configuration
locked, so SQL can't read other workspaces, local files or the network, write files, or
install extensions (see tests/test_query.py).

Charts are described by a JSON chart spec (frontend/src/features/charts/chart-spec.ts);
`compile_spec` turns one into SQL with quoted identifiers and bound parameters only.
"""

from __future__ import annotations

import functools
import math
import os
import threading
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

import re

import duckdb
import pyarrow.parquet as pq
import sqlglot
from sqlglot import exp

from app import cache
from app.config import get_settings
from app.ingest import DATE_FORMATS, NUMBER_RE
from app.models import Dataset
from app.telemetry import count, span, timed

AGGS = {"sum": "SUM", "count": "COUNT", "avg": "AVG", "min": "MIN", "max": "MAX", "count_distinct": "COUNT_DISTINCT"}
NUMERIC_AGGS = {"sum", "avg"}
BUCKETS = ("day", "week", "month", "quarter", "year")
OPS = {"eq", "neq", "gt", "gte", "lt", "lte", "between", "in", "contains", "empty", "not_empty"}
CAST = {"number": "DOUBLE", "date": "TIMESTAMP", "category": "VARCHAR", "text": "VARCHAR"}
ROW_KEY = "*"  # count(*) is written as {"field": "*", "agg": "count"}

MAX_ROWS = 5_000
TIMEOUT_SECONDS = 10
QUERY_WAIT_SECONDS = 8  # how long a query waits for a free slot before asking the person to retry
QUERY_SLOTS = threading.BoundedSemaphore(get_settings().max_concurrent_queries)


class QueryError(ValueError):
    """A problem with the request the user can fix; the message is shown as-is."""


def quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def view_name(dataset_id: str) -> str:
    return f"ds_{dataset_id}"


RESERVED = {"select", "from", "where", "group", "order", "by", "table", "join", "limit", "union", "with", "as", "on", "all", "case"}


def table_names(datasets: list[Dataset]) -> dict[str, str]:
    """Friendly SQL table name per dataset id ("Sales 2026.xlsx" -> sales_2026), unique per workspace."""
    out: dict[str, str] = {}
    taken: set[str] = set()
    for d in sorted(datasets, key=lambda d: (d.created_at is None, d.created_at, d.id)):
        base = "_".join(re.findall(r"[a-z0-9]+", d.name.lower()))[:40] or "data"
        if base[0].isdigit() or base in RESERVED or base.startswith("ds_"):
            base = f"t_{base}"
        name, n = base, 1
        while name in taken:
            n += 1
            name = f"{base}_{n}"
        taken.add(name)
        out[d.id] = name
    return out


def metric_key(m: dict) -> str:
    """Matches metricKey() in frontend/src/features/charts/build-option.ts."""
    return f"{m['agg']}_{m['field']}"


def workspace_dir(workspace_id: str) -> str:
    return os.path.abspath(os.path.join(get_settings().data_dir, workspace_id))


# ---------- connection ----------


# Reading a column the user retyped. A column inferred as text at upload is stored as text; if the user then marks
# it as a number or a date, it must be read with the same rules the upload uses ("₹1,200", "(200)", "05/01/2026"),
# not a bare TRY_CAST, which turns every such value into NULL and silently shrinks totals.
_NUMBER_MACROS = (
    # Same steps as ingest._normalise_numbers: drop spaces, one leading currency symbol and a trailing %,
    # read (200) as -200, accept only well-formed numbers, then remove thousands commas.
    "CREATE MACRO vy_clean(v) AS regexp_replace(regexp_replace(regexp_replace(CAST(v AS VARCHAR), '[[:space:]]', '', 'g'), "
    "'^[$€£₹¥]', ''), '%$', '')",
    "CREATE MACRO vy_unparen(s) AS CASE WHEN s LIKE '(%)' THEN '-' || substr(s, 2, length(s) - 2) ELSE s END",
    "CREATE MACRO vy_num(v) AS CASE WHEN regexp_full_match(vy_unparen(vy_clean(v)), '" + NUMBER_RE.pattern + "') "
    "AND regexp_matches(vy_unparen(vy_clean(v)), '[0-9]') THEN TRY_CAST(replace(vy_unparen(vy_clean(v)), ',', '') AS DOUBLE) END",
)


def stored_as_text(path: str) -> set[str]:
    """Names of the Parquet file's text columns (schema metadata only, cached per file version)."""
    try:
        st = os.stat(path)
    except OSError:
        return set()
    return _stored_as_text(path, st.st_mtime_ns, st.st_size)


@functools.lru_cache(maxsize=512)
def _stored_as_text(path: str, _mtime: int, _size: int) -> set[str]:
    import pyarrow as pa

    schema = pq.read_schema(path)
    return {f.name for f in schema if pa.types.is_string(f.type) or pa.types.is_large_string(f.type)}


def typed_column_sql(column: dict, ref: str, text_stored: bool) -> str:
    """SQL reading one stored column as its declared type. `ref` is the already-quoted source column."""
    kind = CAST.get(column["type"], "VARCHAR")
    if text_stored and column["type"] == "number":
        return f"vy_num({ref})"
    if text_stored and column["type"] == "date":
        fmt = column.get("format")
        if fmt in DATE_FORMATS and fmt != "ISO8601":
            return f"TRY_STRPTIME(TRIM({ref}), '{fmt}')"  # fmt is one of the fixed DATE_FORMATS
        return f"TRY_CAST(TRIM({ref}) AS TIMESTAMP)"
    return f"TRY_CAST({ref} AS {kind})"


def _best_date_format(values: list[str]) -> str | None:
    """The DATE_FORMATS entry that reads the most values (ties go to the earlier, as at upload)."""
    import pandas as pd

    from app.ingest import ISO_DATE_RE

    series = pd.Series(values).str.strip()
    best, best_n = None, 0
    for fmt in DATE_FORMATS:
        if fmt == "ISO8601":
            n = int(series.str.match(ISO_DATE_RE.pattern).sum())
        else:
            n = int(pd.to_datetime(series, format=fmt, errors="coerce").notna().sum())
        if n > best_n:
            best, best_n = fmt, n
    return best


def column_readability(dataset: Dataset, names: list[str]) -> dict[str, dict]:
    """For columns now typed number or date but stored as text: the date format to read them with, and how
    many non-empty values still can't be read (with a few examples), so a retype never shrinks a total silently.

    Returns {name: {"format": str | None, "unreadable": int, "unreadable_examples": [str]}} for those columns only.
    """
    path = _parquet(dataset)
    text_cols = stored_as_text(path)
    by_name = {c["name"]: c for c in dataset.columns}
    todo = [n for n in names if n in text_cols and by_name.get(n, {}).get("type") in ("number", "date")]
    if not todo:
        return {}
    out: dict[str, dict] = {}
    con = connect(dataset.workspace_id, [])  # the macros and the workspace folder, no views needed
    try:
        literal = path.replace("'", "''")
        for name in todo:
            col = dict(by_name[name])
            ref = quote(name)
            raw = f"TRIM(CAST({ref} AS VARCHAR))"
            fmt = None
            if col["type"] == "date":
                sample = [r[0] for r in con.execute(
                    f"SELECT DISTINCT {raw} FROM read_parquet('{literal}') WHERE {raw} <> '' LIMIT 500"  # nosec B608
                ).fetchall()]
                fmt = _best_date_format(sample) if sample else None
                col["format"] = fmt
            bad = f"{raw} <> '' AND {typed_column_sql(col, ref, True)} IS NULL"
            n, examples = con.execute(
                f"SELECT COUNT(*) FILTER (WHERE {bad}), list_slice(list(DISTINCT {raw}) FILTER (WHERE {bad}), 1, 5) "
                f"FROM read_parquet('{literal}')"  # server-built names and path  # nosec B608
            ).fetchone()
            out[name] = {"format": fmt, "unreadable": int(n), "unreadable_examples": sorted(examples or [])}
    finally:
        con.close()
    return out


def connect(workspace_id: str, datasets: list[Dataset], access: dict | None = None) -> duckdb.DuckDBPyConnection:
    """A sandboxed connection with one view per dataset, columns cast to their declared types.

    `access` (app/governance.py) applies a role's permissions: hidden datasets get no view, hidden
    columns are left out and masked columns are rewritten inside the view, so no query can see more.
    """
    from app.governance import column_method, mask_sql

    if access:
        datasets = [d for d in datasets if not (access.get(d.id) and access[d.id].hidden)]
    folder = workspace_dir(workspace_id)
    con = duckdb.connect(
        ":memory:",
        config={
            "autoinstall_known_extensions": False, "autoload_known_extensions": False, "threads": 2, "memory_limit": "512MB",
            "temp_directory": "",  # no spilling to disk: a big sort can't fill the volume every customer shares
        },
    )
    for macro in _NUMBER_MACROS:
        con.execute(macro)
    con.execute("SET allowed_directories=[?]", [folder + os.sep])
    con.execute("SET enable_external_access=false")
    con.execute("SET lock_configuration=true")
    for d in datasets:
        path = os.path.join(folder, f"{d.id}.parquet")
        if not os.path.exists(path):
            continue
        text_cols = stored_as_text(path)
        parts, hidden = [], []
        for c in d.columns:
            if c.get("sql"):
                continue
            expr = typed_column_sql(c, quote(c["name"]), c["name"] in text_cols)
            method = column_method(access, d.id, c["name"])
            if method == "hide":
                hidden.append(c["name"])
                continue
            if method:
                expr = mask_sql(expr, c.get("type") or "text", method, workspace_id)
            parts.append(f"{expr} AS {quote(c['name'])}")
        if not parts:
            continue
        cols = ", ".join(parts)
        literal = path.replace("'", "''")  # server-built path (hex ids); escaped anyway
        typed = f"SELECT {cols} FROM read_parquet('{literal}')"  # server-built names and path  # nosec B608
        # Calculated columns are compiled by app/analytics/formula.py and work on the typed columns
        # (a calculated column that reads a hidden column is left out too).
        extra = "".join(
            f", ({c['sql']}) AS {quote(c['name'])}" for c in d.columns
            if c.get("sql") and not any(quote(h) in c["sql"] for h in hidden) and column_method(access, d.id, c["name"]) != "hide"
        )
        con.execute(f"CREATE VIEW {view_name(d.id)} AS SELECT *{extra} FROM ({typed})")  # nosec B608
    # Friendly names for SQL Lab: SELECT * FROM sales
    present = [d for d in datasets if os.path.exists(os.path.join(folder, f"{d.id}.parquet"))]
    for ds_id, alias in table_names(present).items():
        con.execute(f"CREATE VIEW {quote(alias)} AS SELECT * FROM {view_name(ds_id)}")  # quoted identifiers  # nosec B608
    return con


def _run(con: duckdb.DuckDBPyConnection, sql: str, params: list[Any], op: str = "sql") -> tuple[list[str], list[tuple]]:
    """Run one query when a slot is free, so a burst of heavy queries can't exhaust the server's memory."""
    if not QUERY_SLOTS.acquire(timeout=QUERY_WAIT_SECONDS):
        count("vyuham.query.rejected", op=op)
        raise QueryError("Vyuham is busy right now. Try again in a moment.")
    try:
        return _execute(con, sql, params, op)
    finally:
        QUERY_SLOTS.release()


def _execute(con: duckdb.DuckDBPyConnection, sql: str, params: list[Any], op: str) -> tuple[list[str], list[tuple]]:
    """Execute with a wall-clock timeout.

    Traced as `vyuham.query` with the kind of query (`op`), row count and outcome only: the SQL text
    and its parameters are customer data and are never put on the span.
    """
    with span("vyuham.query", **{"vyuham.query.op": op, "db.system": "duckdb"}) as s, timed("vyuham.query.duration", op=op) as m:
        timer = threading.Timer(TIMEOUT_SECONDS, con.interrupt)
        timer.start()
        try:
            cur = con.execute(sql, params)
            names = [d[0] for d in cur.description]
            rows = cur.fetchmany(MAX_ROWS)
            s.set_attribute("vyuham.query.rows", len(rows))
            s.set_attribute("vyuham.query.truncated", len(rows) >= MAX_ROWS)
            m["outcome"] = "ok"
            return names, rows
        except duckdb.InterruptException as e:
            m["outcome"] = "timeout"
            raise QueryError("That query took too long. Try a shorter date range or fewer groups.") from e
        except duckdb.OutOfMemoryException as e:
            m["outcome"] = "memory"
            raise QueryError("That query needs too much memory. Try fewer groups or a filter.") from e
        except Exception:
            m["outcome"] = "error"
            raise
        finally:
            timer.cancel()


def to_json(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, float):
        return None if math.isnan(v) or math.isinf(v) else v
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, datetime):
        return v.date().isoformat() if (v.hour, v.minute, v.second, v.microsecond) == (0, 0, 0, 0) else v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, (int, str, bool)):
        return v
    return str(v)


def records(names: list[str], rows: list[tuple]) -> list[dict]:
    return [{n: to_json(v) for n, v in zip(names, r)} for r in rows]


# ---------- filters ----------


@dataclass
class Filters:
    """Dashboard-level filters applied on top of a chart's own filters."""

    date_field: str | None = None
    date_from: date | None = None
    date_to: date | None = None
    equals: dict[str, str] = field(default_factory=dict)


def _columns(dataset: Dataset) -> dict[str, str]:
    return {c["name"]: c["type"] for c in dataset.columns}


def _need(cols: dict[str, str], name: str) -> str:
    if name not in cols:
        raise QueryError(f'The column "{name}" isn\'t in this dataset any more.')
    return cols[name]


def _where(cols: dict[str, str], chart_filters: list[dict], dash: Filters | None, params: list[Any]) -> str:
    parts: list[str] = []
    for f in chart_filters:
        name, op, value = f.get("field", ""), f.get("op", ""), f.get("value")
        _need(cols, name)
        if op not in OPS:
            raise QueryError(f"Unknown filter: {op}")
        c = quote(name)
        if op == "empty":
            parts.append(f"{c} IS NULL")
        elif op == "not_empty":
            parts.append(f"{c} IS NOT NULL")
        elif op == "contains":
            parts.append(f"CAST({c} AS VARCHAR) ILIKE ?")
            params.append(f"%{value}%")
        elif op == "between":
            if not isinstance(value, list) or len(value) != 2:
                raise QueryError("A 'between' filter needs two values.")
            parts.append(f"{c} BETWEEN ? AND ?")
            params.extend(value)
        elif op == "in":
            values = value if isinstance(value, list) else [value]
            if not values:
                continue
            parts.append(f"{c} IN ({', '.join('?' for _ in values)})")
            params.extend(values)
        else:
            sym = {"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
            parts.append(f"{c} {sym} ?")
            params.append(value)
    if dash:
        if dash.date_field and dash.date_field in cols:
            if dash.date_from:
                parts.append(f"{quote(dash.date_field)} >= ?")
                params.append(datetime.combine(dash.date_from, datetime.min.time()))
            if dash.date_to:
                parts.append(f"{quote(dash.date_field)} < ? + INTERVAL 1 DAY")
                params.append(datetime.combine(dash.date_to, datetime.min.time()))
        for name, value in dash.equals.items():
            if name in cols and value not in (None, ""):
                parts.append(f"CAST({quote(name)} AS VARCHAR) = ?")
                params.append(str(value))
    return f" WHERE {' AND '.join(parts)}" if parts else ""


# ---------- chart specs ----------


def _bucket_label(col: str, bucket: str) -> str:
    c = quote(col)
    if bucket == "quarter":
        return f"strftime(date_trunc('quarter', {c}), '%Y') || '-Q' || CAST(quarter({c}) AS VARCHAR)"
    fmt = {"day": "%Y-%m-%d", "week": "%Y-%m-%d", "month": "%Y-%m", "year": "%Y"}[bucket]
    return f"strftime(date_trunc('{bucket}', {c}), '{fmt}')"


def compile_spec(spec: dict, dataset: Dataset, dash: Filters | None = None) -> tuple[str, list[Any]]:
    cols = _columns(dataset)
    metrics = spec.get("metrics") or []
    if not metrics:
        raise QueryError("Pick at least one measure.")
    params: list[Any] = []
    selects: list[str] = []
    group_by = spec.get("groupBy") or None
    bucket = spec.get("dateBucket") or None
    is_date_group = False
    if group_by:
        kind = _need(cols, group_by)
        if kind == "date":
            is_date_group = True
            bucket = bucket if bucket in BUCKETS else "month"
            selects.append(f"{_bucket_label(group_by, bucket)} AS {quote(group_by)}")
        else:
            selects.append(f"CAST({quote(group_by)} AS VARCHAR) AS {quote(group_by)}")
    for m in metrics:
        agg, name = m.get("agg"), m.get("field")
        if agg == "metric":
            from app.analytics.semantic import metric_sql

            selects.append(f"{metric_sql(dataset, name)} AS {quote(metric_key(m))}")
            continue
        if agg not in AGGS:
            raise QueryError(f"Unknown calculation: {agg}")
        if name == ROW_KEY:
            if agg != "count":
                raise QueryError("Only 'count' works on whole rows.")
            expr = "COUNT(*)"
        else:
            kind = _need(cols, name)
            if agg in NUMERIC_AGGS and kind != "number":
                raise QueryError(f'"{name}" isn\'t a number column, so it can\'t be {"summed" if agg == "sum" else "averaged"}.')
            expr = f"COUNT(DISTINCT {quote(name)})" if agg == "count_distinct" else f"{AGGS[agg]}({quote(name)})"
        selects.append(f"{expr} AS {quote(metric_key(m))}")

    series_by = spec.get("seriesBy") or None
    if series_by:
        if not group_by:
            raise QueryError("Put a field on Columns before splitting by colour.")
        if series_by == group_by:
            raise QueryError("Colour needs a different field from Columns.")
        if _need(cols, series_by) not in ("category", "text"):
            raise QueryError(f"“{series_by}” can’t split the chart by colour. Use a category or text column.")
        selects.insert(1, f"CAST({quote(series_by)} AS VARCHAR) AS {quote(series_by)}")

    sql = f"SELECT {', '.join(selects)} FROM {view_name(dataset.id)}"
    sql += _where(cols, spec.get("filters") or [], dash, params)
    if series_by:
        return _series_sql(sql, spec, quote(group_by), quote(series_by), [quote(metric_key(m)) for m in metrics], is_date_group), params
    if group_by:
        # Filter/sort in an outer query so the bucketed label (not the raw column) is what we test.
        g = quote(group_by)
        first = quote(metric_key(metrics[0]))
        sort = spec.get("sort") or ("label" if is_date_group else "value_desc")
        order = {"label": f"{g} ASC", "value_desc": f"{first} DESC NULLS LAST", "value_asc": f"{first} ASC NULLS LAST"}.get(sort, f"{g} ASC")
        limit = int(spec.get("limit") or (500 if is_date_group else 50))
        sql = f"SELECT * FROM ({sql} GROUP BY 1) AS q WHERE {g} IS NOT NULL ORDER BY {order} LIMIT {max(1, min(limit, 1000))}"
    return sql, params


MAX_SERIES = 8


def _series_sql(inner: str, spec: dict, g: str, s: str, measures: list[str], is_date_group: bool) -> str:
    """A chart split by colour: one row per (label, series), keeping the MAX_SERIES largest series.

    Series are ranked by the first measure's total; labels are ordered and limited like an unsplit chart,
    with "value" sorts using each label's total across the kept series.
    """
    first = measures[0]
    sort = spec.get("sort") or ("label" if is_date_group else "value_desc")
    rank_order = {"label": f"{g} ASC", "value_desc": "__total DESC NULLS LAST", "value_asc": "__total ASC NULLS LAST"}.get(sort, f"{g} ASC")
    limit = max(1, min(int(spec.get("limit") or (500 if is_date_group else 50)), 1000))
    picked = ", ".join([g, s, *measures])
    return (
        f"WITH q AS ({inner} GROUP BY 1, 2), "
        f"top AS (SELECT {s} AS __s FROM q WHERE {s} IS NOT NULL AND {g} IS NOT NULL "
        f"GROUP BY 1 ORDER BY SUM({first}) DESC NULLS LAST, 1 LIMIT {MAX_SERIES}), "
        f"r AS (SELECT q.*, SUM({first}) OVER (PARTITION BY {g}) AS __total FROM q JOIN top ON q.{s} = top.__s WHERE q.{g} IS NOT NULL), "
        f"k AS (SELECT r.*, DENSE_RANK() OVER (ORDER BY {rank_order}, {g}) AS __rank FROM r) "
        f"SELECT {picked} FROM k WHERE __rank <= {limit} ORDER BY __rank, {s}"
    )


def _parquet(dataset: Dataset) -> str:
    return os.path.join(workspace_dir(dataset.workspace_id), f"{dataset.id}.parquet")


def run_spec(con: duckdb.DuckDBPyConnection, spec: dict, dataset: Dataset, dash: Filters | None = None) -> list[dict]:
    if spec.get("sql"):
        return _run_sql_chart(con, spec)  # can read any of the workspace's tables, so not cached
    sql, params = compile_spec(spec, dataset, dash)

    def compute() -> list[dict]:
        try:
            return records(*_run(con, sql, params, op="chart"))
        except duckdb.Error as e:
            raise QueryError("We couldn't calculate this chart. Check the columns and filters.") from e

    # The compiled SQL carries the spec, filters and approved metric formulas; the version carries the data.
    return cache.cached(cache.key("chart", sql, params, cache.dataset_version(dataset, _parquet(dataset))), compute, "chart")


# ---------- table rows (data grid) ----------


def page_rows(
    con: duckdb.DuckDBPyConnection,
    dataset: Dataset,
    page: int,
    size: int,
    sort: str | None,
    direction: Literal["asc", "desc"],
    filters: list[dict],
    q: str | None = None,
) -> tuple[list[dict], int]:
    cols = _columns(dataset)
    params: list[Any] = []
    where = _where(cols, filters, None, params)
    if q and q.strip() and cols:
        # Free-text search across every column, as text.
        like = " OR ".join(f"CAST({quote(c)} AS VARCHAR) ILIKE ?" for c in cols)
        where = f"{where} AND ({like})" if where else f" WHERE ({like})"
        params.extend([f"%{q.strip()}%"] * len(cols))
    total = _run(con, f"SELECT COUNT(*) FROM {view_name(dataset.id)}{where}", list(params), op="count")[1][0][0]  # values are bound  # nosec B608
    order = ""
    if sort:
        _need(cols, sort)
        order = f" ORDER BY {quote(sort)} {'DESC' if direction == 'desc' else 'ASC'} NULLS LAST"
    size = max(1, min(size, 500))
    sql = f"SELECT * FROM {view_name(dataset.id)}{where}{order} LIMIT {size} OFFSET {max(0, page) * size}"
    return records(*_run(con, sql, params, op="rows")), int(total)


def distinct_values(con: duckdb.DuckDBPyConnection, dataset: Dataset, column: str, limit: int = 200) -> list[str]:
    _need(_columns(dataset), column)
    c = quote(column)
    sql = (
        f"SELECT CAST({c} AS VARCHAR) AS v, COUNT(*) AS n FROM {view_name(dataset.id)} "
        f"WHERE {c} IS NOT NULL GROUP BY 1 ORDER BY n DESC, v LIMIT {int(limit)}"
    )
    k = cache.key("values", sql, cache.dataset_version(dataset, _parquet(dataset)))
    return cache.cached(k, lambda: [r[0] for r in _run(con, sql, [], op="values")[1]], "values")


# ---------- raw SQL (groundwork for the AI round) ----------


def duckdb_message(e: duckdb.Error) -> str:
    """First line of a DuckDB error, plus the line number DuckDB points at ("... (line 3)")."""
    text = str(e)
    first = text.splitlines()[0][:200] if text else "unknown error"
    m = re.search(r"^LINE (\d+):", text, re.M)
    return f"{first} (line {m.group(1)})" if m else first


def run_sql(con: duckdb.DuckDBPyConnection, sql: str, params: list[Any] | None = None) -> list[dict]:
    """Run one read-only SELECT. Anything else is refused before it reaches DuckDB."""
    validate_select(sql)
    try:
        return records(*_run(con, sql, params or []))
    except duckdb.Error as e:
        raise QueryError(f"The query failed: {duckdb_message(e)}") from e


def explain_sql(con: duckdb.DuckDBPyConnection, sql: str, params: list[Any] | None = None) -> str:
    """DuckDB's physical plan for one read-only SELECT, as text."""
    validate_select(sql)
    try:
        _, rows = _run(con, f"EXPLAIN {sql}", params or [], op="explain")
    except duckdb.Error as e:
        raise QueryError(f"The query failed: {duckdb_message(e)}") from e
    return "\n".join(str(r[-1]) for r in rows)


def stream_rows(
    con: duckdb.DuckDBPyConnection, sql: str, params: list[Any] | None = None, *, max_rows: int, timeout: float = 120.0, batch: int = 10_000
):
    """(column names, iterator of row-tuple batches) for exports: no MAX_ROWS cap, a longer timeout.

    Stops with QueryError past `max_rows` rather than silently cutting the file short. The caller
    must finish (or abandon) the iterator before closing the connection.
    """
    timer = threading.Timer(timeout, con.interrupt)
    timer.start()
    try:
        cur = con.execute(sql, params or [])
    except duckdb.InterruptException as e:
        timer.cancel()
        raise QueryError("The export took too long.") from e
    except duckdb.Error as e:
        timer.cancel()
        raise QueryError(f"The query failed: {duckdb_message(e)}") from e
    names = [d[0] for d in cur.description]

    def batches():
        seen = 0
        try:
            while True:
                rows = cur.fetchmany(batch)
                if not rows:
                    return
                seen += len(rows)
                if seen > max_rows:
                    raise QueryError(f"That's more than {max_rows:,} rows. Add a filter or split the export.")
                yield rows
        except duckdb.InterruptException as e:
            raise QueryError("The export took too long.") from e
        finally:
            timer.cancel()

    return names, batches()


def validate_select(sql: str) -> None:
    try:
        statements = sqlglot.parse(sql, read="duckdb")
    except sqlglot.errors.ParseError as e:
        first = e.errors[0] if e.errors else {}
        where = f" (line {first['line']})" if first.get("line") else ""
        what = f": {first['description']}" if first.get("description") else ""
        raise QueryError(f"That isn't valid SQL{what}{where}.") from e
    if len(statements) != 1 or statements[0] is None:
        raise QueryError("Only one statement is allowed.")
    tree = statements[0]
    if not isinstance(tree, (exp.Select, exp.Union, exp.Intersect, exp.Except)):
        raise QueryError("Only SELECT queries are allowed.")
    for node in tree.walk():
        if isinstance(node, (exp.Insert, exp.Update, exp.Delete, exp.Create, exp.Drop, exp.Alter, exp.Command, exp.Copy)):
            raise QueryError("Only SELECT queries are allowed.")
        # Reading files directly would skip the dataset views, and with them access rules and masking.
        if isinstance(node, exp.Func) and _func_name(node) in FILE_FUNCTIONS:
            raise QueryError("Read datasets by their table names. Reading files directly isn't allowed.")
        if isinstance(node, exp.Table) and FILE_LIKE.search(node.name or ""):
            raise QueryError("Read datasets by their table names. Reading files directly isn't allowed.")


FILE_FUNCTIONS = {
    "read_parquet", "parquet_scan", "read_csv", "read_csv_auto", "read_json", "read_json_auto", "read_ndjson",
    "read_ndjson_auto", "read_text", "read_blob", "glob", "parquet_metadata", "parquet_schema", "parquet_file_metadata",
    "parquet_kv_metadata", "read_xlsx", "sniff_csv", "delta_scan", "iceberg_scan",
}
FILE_LIKE = re.compile(r"[/\\]|\.(parquet|csv|tsv|json|ndjson|txt|xlsx|gz|zst)$", re.IGNORECASE)


def _func_name(node: exp.Func) -> str:
    if isinstance(node, exp.Anonymous):
        return str(node.this).lower()
    try:
        return node.sql_name().lower()
    except Exception:
        return type(node).__name__.lower()


def _run_sql_chart(con: duckdb.DuckDBPyConnection, spec: dict) -> list[dict]:
    """A chart saved from SQL Lab: run the query, then name its columns the way the renderer expects
    (the group column keeps its name; each measure column becomes "<agg>_<field>").
    Dashboard filters don't apply to these: the SQL is the whole definition."""
    from app.sql_params import Param, bind

    sql, params = bind(spec["sql"], [Param(**p) for p in spec.get("params") or []])
    rows = run_sql(con, sql, params)
    if not rows:
        return rows
    renames = {m["field"]: metric_key(m) for m in spec.get("metrics") or []}
    missing = [c for c in [*renames, *([spec["groupBy"]] if spec.get("groupBy") else [])] if c not in rows[0]]
    if missing:
        raise QueryError(f'The query no longer returns a column called "{missing[0]}".')
    keep = [spec["groupBy"]] if spec.get("groupBy") else []
    return [{**{k: r[k] for k in keep}, **{renames[f]: r[f] for f in renames}} for r in rows]
