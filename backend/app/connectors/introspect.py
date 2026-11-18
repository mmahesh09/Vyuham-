"""What's in a customer's database: tables and views to pick from, and a preview of one."""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.sql import table as sa_table

from app.connectors.base import ConnSpec, QueryProblem, session

MAX_TABLES = 500
SYSTEM_SCHEMAS = {"information_schema", "pg_catalog", "mysql", "performance_schema", "sys"}


@dataclass(frozen=True)
class TableInfo:
    schema: str | None
    name: str
    kind: str  # table | view
    rows: int | None  # the database's estimate; None when unknown

    @property
    def key(self) -> str:
        return f"{self.schema}.{self.name}" if self.schema else self.name

    def as_dict(self) -> dict:
        return {"key": self.key, "schema": self.schema, "name": self.name, "kind": self.kind, "rows": self.rows}


def _estimates(conn, spec: ConnSpec) -> dict[str, int]:
    """Row estimates. Zero usually means "not analysed yet", so it is left out rather than shown."""
    try:
        with conn.begin_nested():  # a failure here must not abort the surrounding transaction
            if spec.kind == "postgres":
                rows = conn.execute(text("SELECT schemaname, relname, n_live_tup FROM pg_stat_user_tables")).all()
                return {f"{s}.{t}": int(n) for s, t, n in rows if n}
            rows = conn.execute(
                text("SELECT table_name, table_rows FROM information_schema.tables WHERE table_schema = DATABASE()")
            ).all()
            return {t: int(n) for t, n in rows if n}
    except SQLAlchemyError:  # estimates are nice to have; a restricted user may not see the stats views
        return {}


def list_tables(spec: ConnSpec, limit: int | None = MAX_TABLES) -> list[TableInfo]:
    """Tables and views this user can see, sorted; `limit=None` returns all of them."""
    with session(spec) as conn:
        insp = inspect(conn)
        if spec.kind == "postgres":
            schemas = [s for s in insp.get_schema_names() if s not in SYSTEM_SCHEMAS and not s.startswith("pg_")]
        else:
            schemas = [None]  # MySQL: the connection's database only
        est = _estimates(conn, spec)
        out: list[TableInfo] = []
        for schema in schemas:
            for kind, names in (("table", insp.get_table_names(schema=schema)), ("view", insp.get_view_names(schema=schema))):
                for name in names:
                    if "." in name or (schema and "." in schema):
                        continue  # can't be referred to unambiguously as schema.table
                    key = f"{schema}.{name}" if schema else name
                    out.append(TableInfo(schema, name, kind, est.get(key)))
        out.sort(key=lambda t: (t.schema or "", t.name))
        return out if limit is None else out[:limit]


def find_table(spec: ConnSpec, key: str) -> TableInfo:
    for t in list_tables(spec, limit=None):
        if t.key == key:
            return t
    raise QueryProblem(f"There's no table or view called “{key}” that this user can see.")


def table_ref(info: TableInfo):
    return sa_table(info.name, schema=info.schema)


def preview(spec: ConnSpec, key: str, limit: int = 50) -> pd.DataFrame:
    """The first rows exactly as the driver returns them (object columns, so nothing is coerced)."""
    info = find_table(spec, key)
    with session(spec) as conn:
        result = conn.execute(select(text("*")).select_from(table_ref(info)).limit(limit))
        columns = list(result.keys())
        return pd.DataFrame([tuple(r) for r in result.fetchall()], columns=columns, dtype=object)
