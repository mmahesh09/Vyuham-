"""Derived datasets: a SELECT over other datasets, saved as a dataset of its own.

The query runs in the same sandbox as SQL Lab (read-only, one SELECT, workspace tables only). Its
result is typed with the same rules as an upload or a database sync, written to Parquet, and the
datasets it read are recorded as lineage. Rebuilding re-runs the saved query (on demand or on the
dataset's refresh schedule) and then runs the dataset's quality checks.
"""

from __future__ import annotations

import os
from pathlib import Path
from datetime import datetime, timezone

import duckdb
import pandas as pd
from fastapi import HTTPException
import sqlglot
from sqlglot import exp
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.ingest import IngestError, profile_frame, write_parquet
from app.models import Dataset, LineageEdge
from app.query import QueryError, connect, duckdb_message, stream_rows, table_names, validate_select, workspace_dir
from app.sql_params import Param, bind

LAYERS = ("bronze", "silver", "gold")


class MaterializeError(ValueError):
    """The query or its result can't become a dataset; shown to the person as-is."""


def referenced(sql: str, datasets: list[Dataset]) -> list[Dataset]:
    """The workspace datasets a query reads, by friendly name or ds_<id> view."""
    by_name = {alias: ds_id for ds_id, alias in table_names(datasets).items()}
    by_id = {d.id: d for d in datasets}
    ids: list[str] = []
    try:
        tree = sqlglot.parse_one(sql, read="duckdb")
    except sqlglot.errors.ParseError:
        return []
    ctes = {c.alias_or_name.lower() for c in tree.find_all(exp.CTE)}
    for t in tree.find_all(exp.Table):
        name = t.name.lower()
        if name in ctes:
            continue
        ds_id = by_name.get(name) or (name[3:] if name.startswith("ds_") and name[3:] in by_id else None)
        if ds_id and ds_id not in ids:
            ids.append(ds_id)
    return [by_id[i] for i in ids if i in by_id]


def _frame(con: duckdb.DuckDBPyConnection, sql: str, params: list, max_rows: int) -> pd.DataFrame:
    names, batches = stream_rows(con, sql, params, max_rows=max_rows)
    rows = [r for batch in batches for r in batch]
    if len(set(names)) != len(names):
        raise MaterializeError("Two result columns have the same name. Give each column its own name with AS.")
    return pd.DataFrame.from_records(rows, columns=names)


def build(db: Session, ds: Dataset, sql: str, params_spec: list[dict] | None = None) -> Dataset:
    """(Re)build `ds` from a SELECT. Raises MaterializeError or QueryError on a problem the person can fix."""
    from app.routers.datasets import check_quota  # late: the router imports this module

    settings = get_settings()
    params_spec = params_spec or []
    try:
        bound_sql, values = bind(sql, [Param(**p) for p in params_spec])
    except QueryError as e:
        raise MaterializeError(str(e)) from e
    validate_select(bound_sql)
    others = [d for d in db.scalars(select(Dataset).where(Dataset.workspace_id == ds.workspace_id)) if d.id != ds.id]
    sources = referenced(bound_sql, others)
    if any(s.id == ds.id for s in sources):
        raise MaterializeError("A dataset can't be built from itself.")
    con = connect(ds.workspace_id, others)
    try:
        frame = _frame(con, bound_sql, values, settings.report_max_rows)
    except duckdb.Error as e:
        raise QueryError(f"The query failed: {duckdb_message(e)}") from e
    finally:
        con.close()
    if frame.columns.empty:
        raise MaterializeError("The query returned no columns.")
    try:
        result = profile_frame(frame, settings.report_max_rows)
    except IngestError as e:
        raise MaterializeError(str(e)) from e

    path = os.path.join(workspace_dir(ds.workspace_id), f"{ds.id}.parquet")
    tmp_size = int(result.frame.memory_usage(deep=True).sum() // 4)  # rough Parquet size, checked before writing
    old_size = ds.file_size or 0
    try:
        check_quota(db, ds.workspace_id, new_datasets=0, new_bytes=max(0, tmp_size - old_size))
    except HTTPException as e:
        raise MaterializeError(str(e.detail)) from e
    size = write_parquet(result.frame, Path(path))
    now = datetime.now(timezone.utc)
    ds.columns = [c.as_dict() for c in result.columns]
    ds.row_count = len(result.frame)
    ds.file_size = size
    ds.last_synced_at = now
    ds.sync_started_at = ds.sync_finished_at = now
    ds.sync_error = None
    ds.origin = {"kind": "sql", "sql": sql, "params": params_spec}
    record_lineage(db, ds, sources, "sql")
    db.commit()
    return ds


def record_lineage(db: Session, ds: Dataset, sources: list[Dataset], via: str) -> None:
    """Replace the dataset's incoming edges with the sources it was just built from."""
    db.execute(delete(LineageEdge).where(LineageEdge.to_kind == "dataset", LineageEdge.to_id == ds.id))
    for s in sources:
        db.add(LineageEdge(workspace_id=ds.workspace_id, from_kind="dataset", from_id=s.id, to_kind="dataset", to_id=ds.id, via=via))


def rebuild(db: Session, ds: Dataset, trigger: str = "manual") -> Dataset:
    """Re-run a derived dataset's saved query (or re-download a linked one), then its quality checks.
    Failures are recorded on the dataset and re-raised."""
    from app.quality import run_checks

    origin = ds.origin or {}
    if origin.get("kind") not in ("sql", "url"):
        raise MaterializeError("This dataset isn't built from a query or a link.")
    started = datetime.now(timezone.utc)
    try:
        if origin["kind"] == "sql":
            build(db, ds, origin["sql"], origin.get("params") or [])
        else:
            from app.routers.data_platform import download_into  # late: the router imports this module

            download_into(db, ds, origin["url"])
            ds.last_synced_at = ds.sync_finished_at = datetime.now(timezone.utc)
            ds.sync_started_at, ds.sync_error = started, None
            db.commit()
    except (MaterializeError, QueryError) as e:
        db.rollback()
        ds = db.get(Dataset, ds.id, populate_existing=True) or ds
        ds.sync_started_at, ds.sync_finished_at, ds.sync_error = started, datetime.now(timezone.utc), str(e)[:500]
        db.commit()
        raise
    run_checks(db, ds, "refresh")
    return ds


def lineage_for(db: Session, ds: Dataset) -> dict:
    """Upstream and downstream datasets one step away."""
    ups = db.scalars(select(LineageEdge).where(LineageEdge.to_kind == "dataset", LineageEdge.to_id == ds.id)).all()
    downs = db.scalars(select(LineageEdge).where(LineageEdge.from_kind == "dataset", LineageEdge.from_id == ds.id)).all()
    ids = {e.from_id for e in ups} | {e.to_id for e in downs if e.to_kind == "dataset"}
    names = {d.id: d for d in db.scalars(select(Dataset).where(Dataset.id.in_(ids), Dataset.workspace_id == ds.workspace_id))} if ids else {}

    def ref(i: str) -> dict | None:
        d = names.get(i)
        return {"id": d.id, "name": d.name, "layer": d.layer, "source_kind": d.source_kind} if d else None

    return {
        "upstream": [r for r in (ref(e.from_id) for e in ups) if r],
        "downstream": [r for r in (ref(e.to_id) for e in downs if e.to_kind == "dataset") if r],
    }

