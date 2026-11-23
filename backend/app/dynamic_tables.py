"""Dynamic tables: SQL-defined tables Vyuham keeps fresh.

A dynamic table owns one managed dataset (its materialized result). Refreshes run on the background
worker as job kind "dynamic" (app/jobs.py), never inside a web request.

Scheduling is dependency-aware: a table is due when its target freshness has passed, or (when asked)
when a dataset it reads changed after its last refresh. A due table waits while any dynamic table it
depends on is due or refreshing, so upstream tables always refresh first within a pass.

Refresh modes, stated honestly:
- full: re-run the query and replace the table. Always available.
- incremental: only for tables with a watermark column. Re-runs the query filtered to rows whose
  watermark is newer than the last refresh's maximum and appends them. This is correct for append-only
  sources; rows updated or deleted upstream are not reflected until a full refresh. When the result's
  columns change, the refresh is done as a full refresh instead, and labelled so.

Failures are retried with backoff (2, 4, 8, 16, 32 minutes), then the table waits for its next
scheduled time. Every attempt is recorded in DynamicRefresh.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections import deque
from datetime import datetime, timedelta, timezone

import duckdb
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Dataset, DynamicRefresh, DynamicTable, LineageEdge
from app.query import QueryError, connect, duckdb_message, quote, validate_select
from app.sql_params import Param, bind

MAX_RETRIES = 5
MIN_INTERVAL = 5  # minutes


class DynamicTableError(ValueError):
    """Shown to the person as-is."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def schema_signature(columns: list[dict]) -> str:
    sig = json.dumps([[c["name"], c.get("type")] for c in columns if not c.get("sql")])
    return hashlib.sha256(sig.encode()).hexdigest()[:16]


def schema_diff(old: list[dict], new: list[dict]) -> dict | None:
    o = {c["name"]: c.get("type") for c in old if not c.get("sql")}
    n = {c["name"]: c.get("type") for c in new if not c.get("sql")}
    added = [k for k in n if k not in o]
    removed = [k for k in o if k not in n]
    retyped = [f"{k}: {o[k]} → {n[k]}" for k in n if k in o and o[k] != n[k]]
    return {"added": added, "removed": removed, "retyped": retyped} if (added or removed or retyped) else None


# ---------- definition checks ----------


def dependencies(db: Session, workspace_id: str, sql: str, params: list[dict], exclude: str | None = None) -> list[Dataset]:
    """The workspace datasets the query reads (validated as one read-only SELECT)."""
    from app.materialize import referenced

    try:
        bound, _ = bind(sql, [Param(**p) for p in params])
    except QueryError as e:
        raise DynamicTableError(str(e)) from e
    validate_select(bound)
    datasets = [d for d in db.scalars(select(Dataset).where(Dataset.workspace_id == workspace_id)) if d.id != exclude]
    return referenced(bound, datasets)


def check_query(db: Session, workspace_id: str, sql: str, params: list[dict], exclude: str | None = None) -> None:
    """Plan the query against the real tables, so missing tables or columns are caught when it's saved."""
    datasets = [d for d in db.scalars(select(Dataset).where(Dataset.workspace_id == workspace_id)) if d.id != exclude]
    bound, values = bind(sql, [Param(**p) for p in params])
    con = connect(workspace_id, datasets)
    try:
        con.execute(f"EXPLAIN {bound}", values)
    except duckdb.Error as e:
        raise DynamicTableError(f"The query doesn't run: {duckdb_message(e)}") from e
    finally:
        con.close()


def upstream_graph(db: Session, workspace_id: str) -> dict[str, set[str]]:
    """dataset id -> dataset ids it is built from (dynamic tables, query-built datasets and pipelines)."""
    g: dict[str, set[str]] = {}
    for e in db.scalars(select(LineageEdge).where(LineageEdge.workspace_id == workspace_id, LineageEdge.to_kind == "dataset")).all():
        g.setdefault(e.to_id, set()).add(e.from_id)
    for t in db.scalars(select(DynamicTable).where(DynamicTable.workspace_id == workspace_id)).all():
        g.setdefault(t.dataset_id, set()).update(t.upstream_ids or [])
    return g


def would_cycle(db: Session, workspace_id: str, dataset_id: str | None, upstream_ids: list[str]) -> list[str] | None:
    """The cycle (as dataset ids) that making `dataset_id` read `upstream_ids` would create, or None."""
    if dataset_id is None:
        return None
    if dataset_id in upstream_ids:
        return [dataset_id, dataset_id]
    g = upstream_graph(db, workspace_id)
    g[dataset_id] = set(upstream_ids)
    # Does any upstream (transitively) read dataset_id?
    for start in upstream_ids:
        q, parent = deque([start]), {start: None}
        while q:
            cur = q.popleft()
            if cur == dataset_id:
                path = [cur]
                while parent[path[-1]] is not None:
                    path.append(parent[path[-1]])
                return [dataset_id, *reversed(path)]
            for nxt in g.get(cur, ()):
                if nxt not in parent:
                    parent[nxt] = cur
                    q.append(nxt)
    return None


def next_due(t: DynamicTable, after: datetime) -> datetime | None:
    if t.paused or not t.interval_minutes:
        return None
    return after + timedelta(minutes=max(MIN_INTERVAL, t.interval_minutes))


# ---------- scheduler ----------


def find_due(db: Session, now: datetime) -> list[tuple[DynamicTable, str]]:
    """(table, trigger) for every table that should refresh now, upstream tables first."""
    tables = db.scalars(select(DynamicTable).where(DynamicTable.paused.is_(False))).all()
    if not tables:
        return []
    by_ds = {t.dataset_id: t for t in tables}
    ds_ids = {i for t in tables for i in (t.upstream_ids or [])}
    changed = {d.id: _aware(d.last_synced_at) or _aware(d.updated_at) for d in db.scalars(select(Dataset).where(Dataset.id.in_(ds_ids)))} if ds_ids else {}
    due: dict[str, str] = {}
    for t in tables:
        if t.status == "refreshing":
            continue
        nxt = _aware(t.next_refresh_at)
        last = _aware(t.last_refresh_at)
        if nxt is not None and nxt <= now:
            due[t.id] = "retry" if t.failures else "schedule"
        elif t.on_upstream_change and last is not None and any((changed.get(u) or last) > last for u in (t.upstream_ids or [])):
            due[t.id] = "upstream"
    # Wait for upstream dynamic tables that are due or still refreshing.
    def blocked(t: DynamicTable, seen: set[str]) -> bool:
        for u in t.upstream_ids or []:
            up = by_ds.get(u)
            if up is None or up.id in seen:
                continue
            if up.status == "refreshing" or up.id in due or blocked(up, seen | {up.id}):
                return True
        return False

    ready = [t for t in tables if t.id in due and not blocked(t, {t.id})]
    depth: dict[str, int] = {}

    def level(t: DynamicTable, seen: frozenset) -> int:
        if t.id in depth:
            return depth[t.id]
        ups = [by_ds[u] for u in (t.upstream_ids or []) if u in by_ds and by_ds[u].id not in seen]
        depth[t.id] = 1 + max((level(u, seen | {u.id}) for u in ups), default=0)
        return depth[t.id]

    ready.sort(key=lambda t: level(t, frozenset({t.id})))
    return [(t, due[t.id]) for t in ready]


# ---------- refresh ----------


def queue_refresh(db: Session, t: DynamicTable, trigger: str) -> DynamicRefresh:
    mode = "incremental" if t.refresh_mode == "incremental" and t.watermark_column and t.last_refresh_at else "full"
    r = DynamicRefresh(workspace_id=t.workspace_id, table_id=t.id, trigger=trigger, mode=mode, status="queued",
                       attempt=t.failures + 1 if trigger == "retry" else 1)
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def refresh(db: Session, t: DynamicTable, r: DynamicRefresh) -> DynamicRefresh:
    """Run one refresh to the end. Never raises for the table's own problems: they are recorded."""
    from app.audit import log_query
    from app.materialize import build

    ds = db.get(Dataset, t.dataset_id)
    started = time.perf_counter()
    r.status, r.started_at = "running", _now()
    t.status = "refreshing"
    db.commit()
    old_columns = list(ds.columns or []) if ds else []
    try:
        if ds is None:
            raise DynamicTableError("The table's data was deleted.")
        if r.mode == "incremental":
            added, note = _incremental(db, t, ds)
            r.rows_added = added
            if note:
                r.mode = note
        if r.mode != "incremental":
            build(db, ds, t.sql, t.params or [])
            ds = db.get(Dataset, t.dataset_id)
            r.rows_added = ds.row_count
            if t.watermark_column and any(c["name"] == t.watermark_column for c in ds.columns):
                t.watermark_value = _max_watermark(t, ds)
        r.rows = ds.row_count
        change = schema_diff(old_columns, ds.columns) if old_columns else None
        r.schema_change = change
        t.schema_hash = schema_signature(ds.columns)
        t.upstream_ids = [d.id for d in dependencies(db, t.workspace_id, t.sql, t.params or [], exclude=t.dataset_id)]
        r.status = "success"
        t.status, t.last_error, t.failures = "ok", None, 0
        t.last_refresh_at = _now()
        t.next_refresh_at = next_due(t, t.last_refresh_at)
    except Exception as e:  # recorded, then retried with backoff
        db.rollback()
        t = db.get(DynamicTable, t.id, populate_existing=True)
        r = db.get(DynamicRefresh, r.id, populate_existing=True)
        message = str(e) if isinstance(e, (DynamicTableError, QueryError, ValueError)) else f"{type(e).__name__}: {e}"
        r.status, r.error = "failed", message[:1000]
        t.status, t.last_error = "failed", message[:1000]
        t.failures += 1
        if t.failures <= MAX_RETRIES:
            t.next_refresh_at = _now() + timedelta(minutes=2 ** t.failures)
        else:
            t.next_refresh_at = next_due(t, _now())
    r.finished_at = _now()
    r.duration_ms = int((time.perf_counter() - started) * 1000)
    db.commit()
    log_query(db, t.workspace_id, t.created_by, "dynamic", started, "ok" if r.status == "success" else "error", r.rows,
              ref_kind="dynamic_table", ref_id=t.id)
    return r


def _max_watermark(t: DynamicTable, ds: Dataset) -> str | None:
    from app.routers.datasets import parquet_path

    path = parquet_path(ds.workspace_id, ds.id)
    if not path.exists():
        return None
    col = pd.read_parquet(path, columns=[t.watermark_column])[t.watermark_column]
    v = col.max()
    return None if pd.isna(v) else str(v)


def _incremental(db: Session, t: DynamicTable, ds: Dataset) -> tuple[int, str | None]:
    """Append rows newer than the watermark. Returns (rows added, None) or (0, "full") to fall back."""
    from app.ingest import profile_frame, write_parquet
    from app.routers.datasets import parquet_path

    path = parquet_path(ds.workspace_id, ds.id)
    if not path.exists() or t.watermark_value is None:
        return 0, "full"
    bound, values = bind(t.sql, [Param(**p) for p in t.params or []])
    validate_select(bound)
    others = [d for d in db.scalars(select(Dataset).where(Dataset.workspace_id == t.workspace_id)) if d.id != ds.id]
    con = connect(t.workspace_id, others)
    try:
        wm = quote(t.watermark_column)
        col_type = next((c.get("type") for c in ds.columns if c["name"] == t.watermark_column), "text")
        cast = {"number": "DOUBLE", "date": "TIMESTAMP"}.get(col_type, "VARCHAR")
        cur = con.execute(
            f"SELECT * FROM ({bound}) AS q WHERE CAST(q.{wm} AS {cast}) > CAST(? AS {cast})", [*values, t.watermark_value]  # nosec B608
        )
        cols = [d[0] for d in cur.description]
        new = pd.DataFrame.from_records(cur.fetchmany(get_settings().report_max_rows + 1), columns=cols)
    except duckdb.Error as e:
        raise DynamicTableError(f"The query failed: {duckdb_message(e)}") from e
    finally:
        con.close()
    existing = pd.read_parquet(path)
    if list(existing.columns) != cols:
        return 0, "full"  # the result's shape changed: rebuild instead
    if not len(new):
        ds.sync_finished_at = ds.last_synced_at = _now()
        db.commit()
        return 0, None
    frame = pd.concat([existing, new.astype(existing.dtypes.to_dict(), errors="ignore")], ignore_index=True)
    if len(frame) > get_settings().report_max_rows:
        raise DynamicTableError(f"The table would have more than {get_settings().report_max_rows} rows.")
    result = profile_frame(frame, get_settings().report_max_rows)
    ds.file_size = write_parquet(result.frame, path)
    ds.columns = [c.as_dict() for c in result.columns]
    ds.row_count = len(result.frame)
    ds.last_synced_at = ds.sync_finished_at = _now()
    t.watermark_value = _max_watermark(t, ds)
    db.commit()
    return len(new), None


def graph_for(db: Session, workspace_id: str) -> dict:
    """Nodes (datasets and dynamic tables) and edges for the dependency graph view."""
    tables = db.scalars(select(DynamicTable).where(DynamicTable.workspace_id == workspace_id)).all()
    ids = {t.dataset_id for t in tables} | {u for t in tables for u in (t.upstream_ids or [])}
    ds = {d.id: d for d in db.scalars(select(Dataset).where(Dataset.id.in_(ids), Dataset.workspace_id == workspace_id))} if ids else {}
    by_ds = {t.dataset_id: t for t in tables}
    nodes = [{"id": i, "name": ds[i].name if i in ds else "(deleted)", "kind": "dynamic" if i in by_ds else "dataset",
              "table_id": by_ds[i].id if i in by_ds else None, "status": by_ds[i].status if i in by_ds else None,
              "layer": ds[i].layer if i in ds else None} for i in ids]
    edges = [{"from": u, "to": t.dataset_id} for t in tables for u in (t.upstream_ids or [])]
    return {"nodes": nodes, "edges": edges}
