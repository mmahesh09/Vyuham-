"""DuckDB query engine over a workspace's Parquet files.

Every request opens a fresh in-memory DuckDB that can read only the workspace's own folder:
`allowed_directories` is set, then external access is switched off and the configuration
locked, so SQL can't read other workspaces, local files or the network, write files, or
install extensions (see tests/test_query.py).

Charts are described by a JSON chart spec (frontend/src/features/charts/chart-spec.ts);
`compile_spec` turns one into SQL with quoted identifiers and bound parameters only.
"""

from __future__ import annotations

import math
import os
import threading
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

import re

import duckdb
import sqlglot
from sqlglot import exp

from app.config import get_settings
from app.models import Dataset

AGGS = {"sum": "SUM", "count": "COUNT", "avg": "AVG", "min": "MIN", "max": "MAX", "count_distinct": "COUNT_DISTINCT"}
NUMERIC_AGGS = {"sum", "avg"}
BUCKETS = ("day", "week", "month", "quarter", "year")
OPS = {"eq", "neq", "gt", "gte", "lt", "lte", "between", "in", "contains", "empty", "not_empty"}
CAST = {"number": "DOUBLE", "date": "TIMESTAMP", "category": "VARCHAR", "text": "VARCHAR"}
ROW_KEY = "*"  # count(*) is written as {"field": "*", "agg": "count"}

MAX_ROWS = 5_000
TIMEOUT_SECONDS = 10


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


def connect(workspace_id: str, datasets: list[Dataset]) -> duckdb.DuckDBPyConnection:
    """A sandboxed connection with one view per dataset, columns cast to their declared types."""
    folder = workspace_dir(workspace_id)
    con = duckdb.connect(
        ":memory:",
        config={"autoinstall_known_extensions": False, "autoload_known_extensions": False, "threads": 2, "memory_limit": "512MB"},
    )
    con.execute("SET allowed_directories=[?]", [folder + os.sep])
    con.execute("SET enable_external_access=false")
    con.execute("SET lock_configuration=true")
    for d in datasets:
        path = os.path.join(folder, f"{d.id}.parquet")
        if not os.path.exists(path):
            continue
        cols = ", ".join(
            f"TRY_CAST({quote(c['name'])} AS {CAST.get(c['type'], 'VARCHAR')}) AS {quote(c['name'])}" for c in d.columns
        )
        literal = path.replace("'", "''")  # server-built path (hex ids); escaped anyway
        con.execute(f"CREATE VIEW {view_name(d.id)} AS SELECT {cols} FROM read_parquet('{literal}')")
    # Friendly names for SQL Lab: SELECT * FROM sales
    present = [d for d in datasets if os.path.exists(os.path.join(folder, f"{d.id}.parquet"))]
    for ds_id, alias in table_names(present).items():
        con.execute(f"CREATE VIEW {quote(alias)} AS SELECT * FROM {view_name(ds_id)}")
    return con


def _run(con: duckdb.DuckDBPyConnection, sql: str, params: list[Any]) -> tuple[list[str], list[tuple]]:
    """Execute with a wall-clock timeout."""
    timer = threading.Timer(TIMEOUT_SECONDS, con.interrupt)
    timer.start()
    try:
        cur = con.execute(sql, params)
        names = [d[0] for d in cur.description]
        return names, cur.fetchmany(MAX_ROWS)
    except duckdb.InterruptException as e:
        raise QueryError("That query took too long. Try a shorter date range or fewer groups.") from e
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

    sql = f"SELECT {', '.join(selects)} FROM {view_name(dataset.id)}"
    sql += _where(cols, spec.get("filters") or [], dash, params)
    if group_by:
        # Filter/sort in an outer query so the bucketed label (not the raw column) is what we test.
        g = quote(group_by)
        first = quote(metric_key(metrics[0]))
        sort = spec.get("sort") or ("label" if is_date_group else "value_desc")
        order = {"label": f"{g} ASC", "value_desc": f"{first} DESC NULLS LAST", "value_asc": f"{first} ASC NULLS LAST"}.get(sort, f"{g} ASC")
        limit = int(spec.get("limit") or (500 if is_date_group else 50))
        sql = f"SELECT * FROM ({sql} GROUP BY 1) AS q WHERE {g} IS NOT NULL ORDER BY {order} LIMIT {max(1, min(limit, 1000))}"
    return sql, params


def run_spec(con: duckdb.DuckDBPyConnection, spec: dict, dataset: Dataset, dash: Filters | None = None) -> list[dict]:
    if spec.get("sql"):
        return _run_sql_chart(con, spec)
    sql, params = compile_spec(spec, dataset, dash)
    try:
        return records(*_run(con, sql, params))
    except duckdb.Error as e:
        raise QueryError("We couldn't calculate this chart. Check the columns and filters.") from e


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
    total = con.execute(f"SELECT COUNT(*) FROM {view_name(dataset.id)}{where}", params).fetchone()[0]
    order = ""
    if sort:
        _need(cols, sort)
        order = f" ORDER BY {quote(sort)} {'DESC' if direction == 'desc' else 'ASC'} NULLS LAST"
    size = max(1, min(size, 500))
    sql = f"SELECT * FROM {view_name(dataset.id)}{where}{order} LIMIT {size} OFFSET {max(0, page) * size}"
    return records(*_run(con, sql, params)), int(total)


def distinct_values(con: duckdb.DuckDBPyConnection, dataset: Dataset, column: str, limit: int = 200) -> list[str]:
    _need(_columns(dataset), column)
    c = quote(column)
    sql = (
        f"SELECT CAST({c} AS VARCHAR) AS v, COUNT(*) AS n FROM {view_name(dataset.id)} "
        f"WHERE {c} IS NOT NULL GROUP BY 1 ORDER BY n DESC, v LIMIT {int(limit)}"
    )
    return [r[0] for r in con.execute(sql).fetchall()]


# ---------- raw SQL (groundwork for the AI round) ----------


def run_sql(con: duckdb.DuckDBPyConnection, sql: str) -> list[dict]:
    """Run one read-only SELECT. Anything else is refused before it reaches DuckDB."""
    validate_select(sql)
    try:
        return records(*_run(con, sql, []))
    except duckdb.Error as e:
        raise QueryError(f"The query failed: {str(e).splitlines()[0][:200]}") from e


def validate_select(sql: str) -> None:
    try:
        statements = sqlglot.parse(sql, read="duckdb")
    except sqlglot.errors.ParseError as e:
        raise QueryError("That isn't valid SQL.") from e
    if len(statements) != 1 or statements[0] is None:
        raise QueryError("Only one statement is allowed.")
    tree = statements[0]
    if not isinstance(tree, (exp.Select, exp.Union, exp.Intersect, exp.Except)):
        raise QueryError("Only SELECT queries are allowed.")
    for node in tree.walk():
        if isinstance(node, (exp.Insert, exp.Update, exp.Delete, exp.Create, exp.Drop, exp.Alter, exp.Command, exp.Copy)):
            raise QueryError("Only SELECT queries are allowed.")


def _run_sql_chart(con: duckdb.DuckDBPyConnection, spec: dict) -> list[dict]:
    """A chart saved from SQL Lab: run the query, then name its columns the way the renderer expects
    (the group column keeps its name; each measure column becomes "<agg>_<field>").
    Dashboard filters don't apply to these: the SQL is the whole definition."""
    rows = run_sql(con, spec["sql"])
    if not rows:
        return rows
    renames = {m["field"]: metric_key(m) for m in spec.get("metrics") or []}
    missing = [c for c in [*renames, *([spec["groupBy"]] if spec.get("groupBy") else [])] if c not in rows[0]]
    if missing:
        raise QueryError(f'The query no longer returns a column called "{missing[0]}".')
    keep = [spec["groupBy"]] if spec.get("groupBy") else []
    return [{**{k: r[k] for k in keep}, **{renames[f]: r[f] for f in renames}} for r in rows]
