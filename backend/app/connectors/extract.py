"""Read a whole table, or the result of one SELECT, from a customer's database into a DataFrame.

A custom query is parsed, checked and then regenerated, and the regenerated SQL is what runs. Comments
never reach the database, so nothing can hide from the check in syntax only the server understands
(MySQL's `/*! ... */`, or `--x`, which MySQL reads as two minus signs).

The checks are a second layer. The read-only transaction stops writes, and a read-only database user
remains the recommended setup; functions the customer defined themselves can't be judged from here.
"""

from __future__ import annotations

import re
import time

import pandas as pd
import sqlglot
from sqlalchemy import select, text
from sqlglot import exp
from sqlglot.errors import SqlglotError

from app.connectors.base import ConnectorError, ConnSpec, QueryProblem, session
from app.connectors.introspect import SYSTEM_SCHEMAS, find_table, table_ref

CHUNK = 50_000
MAX_QUERY_CHARS = 20_000
READ_DEADLINE_SECONDS = 240  # inside the worker's 300-second job limit, so a slow read fails cleanly
# Anything that writes, changes the schema, locks rows, runs procedures or touches session state.
FORBIDDEN = (
    exp.Insert, exp.Update, exp.Delete, exp.Merge, exp.Create, exp.Drop, exp.Alter, exp.Command,
    exp.Into, exp.Lock, exp.Grant, exp.TruncateTable, exp.Transaction, exp.Commit, exp.Rollback, exp.Set,
    exp.Hint, exp.Parameter, exp.SessionParameter, exp.Placeholder,
)
# Functions that wait, lock, touch files or the network, end other sessions, change settings, or run SQL from text.
BLOCKED_FUNCTIONS = {
    "set_config", "current_setting", "nextval", "setval", "ts_stat", "ts_rewrite", "loread", "lowrite",
    "sleep", "benchmark", "get_lock", "release_lock", "release_all_locks", "is_free_lock", "is_used_lock",
    "load_file", "master_pos_wait", "source_pos_wait", "wait_for_executed_gtid_set",
    "wait_until_sql_thread_after_gtids", "sys_exec", "sys_eval", "sys_get", "sys_set",
}
BLOCKED_PREFIXES = (
    "pg_", "dblink", "lo_", "binary_upgrade_", "crosstab", "query_to_xml", "table_to_xml", "schema_to_xml",
    "database_to_xml", "cursor_to_xml",
)
ALLOWED_PG_FUNCTIONS = {"pg_typeof", "pg_size_pretty", "pg_column_size"}
EXECUTABLE_COMMENT = re.compile(r"/\*M?!")
NOT_READ_ONLY = "Only SELECT queries can be synced. This one writes or locks data."


def _function_name(node: exp.Func) -> str:
    return (node.name if isinstance(node, exp.Anonymous) else node.sql_name()).lower()


def _check(root: exp.Expression) -> None:
    if not isinstance(root, exp.Query):
        raise QueryProblem("Only SELECT queries can be synced.")
    for node in root.walk():
        if isinstance(node, FORBIDDEN):
            raise QueryProblem(NOT_READ_ONLY)
        if isinstance(node, exp.Func):
            name = _function_name(node)
            if name not in ALLOWED_PG_FUNCTIONS and (name in BLOCKED_FUNCTIONS or name.startswith(BLOCKED_PREFIXES)):
                raise QueryProblem(f"The function {name} isn't allowed in a synced query.")
        elif isinstance(node, exp.Table):
            parts = {node.db.lower(), node.catalog.lower()}
            if parts & SYSTEM_SCHEMAS or any(p.startswith("pg_") for p in parts) or node.name.lower().startswith("pg_"):
                raise QueryProblem("Synced queries can't read the database's system tables.")


def _parse(sql: str, dialect: str) -> exp.Expression:
    try:
        statements = [s for s in sqlglot.parse(sql, read=dialect) if s is not None]
    except (SqlglotError, RecursionError) as e:
        raise QueryProblem("We couldn't read this query. Check the SQL.") from e
    if len(statements) != 1:
        raise QueryProblem("Use a single SELECT statement.")
    return statements[0]


def validate_query(sql: str, kind: str) -> str:
    """The SQL to run for this query if it is exactly one safe SELECT; otherwise a ConnectorError."""
    sql = (sql or "").strip().rstrip(";").strip()
    if not sql:
        raise QueryProblem("Write a SELECT query.")
    if len(sql) > MAX_QUERY_CHARS:
        raise QueryProblem("This query is too long.")
    if EXECUTABLE_COMMENT.search(sql):
        raise QueryProblem("Remove the /*! ... */ comment from this query.")
    dialect = "postgres" if kind == "postgres" else "mysql"
    root = _parse(sql, dialect)
    _check(root)
    canonical = root.sql(dialect=dialect, comments=False)
    _check(_parse(canonical, dialect))  # what runs must pass the same checks
    return canonical


def _read_frames(result, max_rows: int) -> pd.DataFrame:
    columns = list(result.keys())
    deadline = time.monotonic() + READ_DEADLINE_SECONDS
    chunks: list[pd.DataFrame] = []
    total = 0
    while rows := result.fetchmany(CHUNK):
        chunks.append(pd.DataFrame.from_records([tuple(r) for r in rows], columns=columns, coerce_float=True))
        total += len(rows)
        if total > max_rows:
            raise QueryProblem(f"This returns more than {max_rows:,} rows, the beta limit. Use a query with a filter or fewer rows.")
        if time.monotonic() > deadline:
            raise QueryProblem(f"Reading this data took longer than {READ_DEADLINE_SECONDS // 60} minutes. Use a query with fewer rows.")
    return pd.concat(chunks, ignore_index=True) if chunks else pd.DataFrame(columns=columns)


def extract(spec: ConnSpec, *, table: str | None = None, query: str | None = None, max_rows: int = 1_000_000) -> pd.DataFrame:
    """All rows of `table` ("schema.table") or of `query`, capped at `max_rows` (more is an error)."""
    if (table is None) == (query is None):
        raise ConnectorError("Pick a table or write a query.")
    limit = int(max_rows) + 1
    if table is not None:
        stmt = select(text("*")).select_from(table_ref(find_table(spec, table))).limit(limit)
        with session(spec) as conn:
            with conn.execution_options(stream_results=True).execute(stmt) as result:
                return _read_frames(result, max_rows)

    sql = f"SELECT * FROM ({validate_query(query or '', spec.kind)}) AS vyuham_query LIMIT {limit}"
    with session(spec) as conn:
        # no_parameters: a % or : in the query is plain text, not a placeholder.
        streaming = conn.execution_options(stream_results=True, no_parameters=True)
        with streaming.exec_driver_sql(sql) as result:
            return _read_frames(result, max_rows)
