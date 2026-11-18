"""Read a whole table, or the result of one SELECT, from a customer's database into a DataFrame."""

from __future__ import annotations

import pandas as pd
import sqlglot
from sqlalchemy import select, text
from sqlglot import exp

from app.connectors.base import ConnectorError, ConnSpec, session
from app.connectors.introspect import find_table, table_ref

CHUNK = 50_000
MAX_QUERY_CHARS = 20_000
# Anything that writes, changes the schema, locks rows or runs procedures.
FORBIDDEN = (
    exp.Insert, exp.Update, exp.Delete, exp.Merge, exp.Create, exp.Drop, exp.Alter, exp.Command,
    exp.Into, exp.Lock, exp.Grant, exp.TruncateTable, exp.Transaction, exp.Commit, exp.Rollback, exp.Set,
)


def validate_query(sql: str, kind: str) -> str:
    """The query, trimmed, if it is exactly one read-only SELECT; otherwise a ConnectorError."""
    sql = (sql or "").strip().rstrip(";").strip()
    if not sql:
        raise ConnectorError("Write a SELECT query.")
    if len(sql) > MAX_QUERY_CHARS:
        raise ConnectorError("This query is too long.")
    dialect = "postgres" if kind == "postgres" else "mysql"
    try:
        statements = [s for s in sqlglot.parse(sql, read=dialect) if s is not None]
    except sqlglot.errors.ParseError as e:
        raise ConnectorError("We couldn't read this query. Check the SQL.") from e
    if len(statements) != 1:
        raise ConnectorError("Use a single SELECT statement.")
    root = statements[0]
    if not isinstance(root, exp.Query):
        raise ConnectorError("Only SELECT queries can be synced.")
    if any(isinstance(node, FORBIDDEN) for node in root.walk()):
        raise ConnectorError("Only SELECT queries can be synced. This one writes or locks data.")
    return sql


def extract(spec: ConnSpec, *, table: str | None = None, query: str | None = None, max_rows: int = 1_000_000) -> pd.DataFrame:
    """All rows of `table` ("schema.table") or of `query`, capped at `max_rows` (more is an error)."""
    if (table is None) == (query is None):
        raise ConnectorError("Pick a table or write a query.")
    if table is not None:
        stmt = select(text("*")).select_from(table_ref(find_table(spec, table))).limit(max_rows + 1)
    else:
        sql = validate_query(query or "", spec.kind)
        stmt = text(f"SELECT * FROM ({sql}) AS vyuham_query LIMIT {int(max_rows) + 1}")

    chunks: list[pd.DataFrame] = []
    total = 0
    with session(spec) as conn:
        for chunk in pd.read_sql(stmt, conn, chunksize=CHUNK):
            chunks.append(chunk)
            total += len(chunk)
            if total > max_rows:
                raise ConnectorError(
                    f"This returns more than {max_rows:,} rows, the beta limit. Use a query with a filter or fewer rows."
                )
    # pandas yields one empty frame (with the columns) when there are no rows.
    return pd.concat(chunks, ignore_index=True) if chunks else pd.DataFrame()
