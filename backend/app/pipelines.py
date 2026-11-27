"""ETL/ELT pipelines: a DAG of steps that read datasets, transform them in SQL, check them and write
managed datasets. Runs happen on the background worker (app/jobs.py), never inside a web request.

A pipeline's `graph` is the canvas document ({nodes, edges}). Each node's `data.config.type` is one of:

    schedule     marks how the pipeline starts (the schedule itself is on the pipeline)
    source       {dataset_id}                                read one dataset
    sql          {sql, python?}                              a SELECT over upstream steps and/or datasets
    dedupe       {keys: [..], order_by?}                     keep one row per key (the latest by order_by)
    validate     {checks: [..], on_fail: fail|warn|drop}     data quality checks; passes rows through
    destination  {target_name, layer, mode, watermark?}      write the input to a managed dataset

Steps are referred to in SQL by their `name` (config.name, an identifier). Every step's result is a
DuckDB temp table in one sandboxed connection for the run, and is also saved under the run's folder
so "retry selected steps" can reuse what already succeeded. Python code on a sql step is generated for
export (to run in your own orchestrator); Vyuham executes the SQL, and says so.

Writes: `replace` rebuilds the target (a full refresh), `append` adds every row, `incremental` adds only
rows whose watermark column is newer than the target's current maximum. Overwriting a dataset that
this pipeline didn't create needs explicit confirmation when the run is started.
"""

from __future__ import annotations


import re
import shutil
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path

import duckdb
import pandas as pd
import pyarrow.parquet as pq
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Dataset, Pipeline, PipelineRun
from app.query import QueryError, connect, duckdb_message, quote, table_names, validate_select, view_name, workspace_dir

STEP_TYPES = ("schedule", "source", "sql", "dedupe", "validate", "destination")
KIND_FOR = {"schedule": "trigger", "source": "integration", "sql": "agent", "dedupe": "agent", "validate": "review", "destination": "delivery"}
MAX_NODES = 20
NAME_RX = re.compile(r"^[a-z_][a-z0-9_]{0,39}$")
CHECKS = ("not_null", "unique", "accepted_values", "references", "row_count_min", "expression")


class PipelineError(ValueError):
    """A problem with the pipeline definition or a step; shown to the person as-is."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def slug(text: str) -> str:
    s = "_".join(re.findall(r"[a-z0-9]+", (text or "").lower()))[:40] or "step"
    return f"s_{s}" if s[0].isdigit() else s


# ---------- graph ----------


def nodes_of(graph: dict) -> list[dict]:
    return [n for n in (graph or {}).get("nodes") or [] if isinstance(n, dict) and n.get("id")]


def edges_of(graph: dict) -> list[dict]:
    return [e for e in (graph or {}).get("edges") or [] if isinstance(e, dict) and e.get("source") and e.get("target")]


def config(node: dict) -> dict:
    return ((node.get("data") or {}).get("config")) or {}


def step_type(node: dict) -> str:
    return config(node).get("type") or "schedule"


def step_name(node: dict) -> str:
    return config(node).get("name") or slug((node.get("data") or {}).get("label") or node["id"])


def topo_order(graph: dict) -> list[str]:
    """Node ids in dependency order. Raises on a cycle."""
    ids = [n["id"] for n in nodes_of(graph)]
    indeg = {i: 0 for i in ids}
    out: dict[str, list[str]] = {i: [] for i in ids}
    for e in edges_of(graph):
        if e["source"] in indeg and e["target"] in indeg:
            out[e["source"]].append(e["target"])
            indeg[e["target"]] += 1
    q = deque(i for i in ids if indeg[i] == 0)
    order = []
    while q:
        i = q.popleft()
        order.append(i)
        for t in out[i]:
            indeg[t] -= 1
            if indeg[t] == 0:
                q.append(t)
    if len(order) != len(ids):
        raise PipelineError("The pipeline has a cycle. Remove a connection so every step runs after the ones it reads.")
    return order


def upstream(graph: dict, node_id: str) -> list[str]:
    return [e["source"] for e in edges_of(graph) if e["target"] == node_id]


def downstream_closure(graph: dict, ids: list[str]) -> set[str]:
    seen = set(ids)
    q = deque(ids)
    while q:
        i = q.popleft()
        for e in edges_of(graph):
            if e["source"] == i and e["target"] not in seen:
                seen.add(e["target"])
                q.append(e["target"])
    return seen


def validate_graph(graph: dict, datasets: list[Dataset]) -> list[str]:
    """Problems that stop a pipeline from running, in plain words (empty = runnable)."""
    problems: list[str] = []
    nodes = nodes_of(graph)
    if not nodes:
        return ["Add at least one step."]
    if len(nodes) > MAX_NODES:
        problems.append(f"A pipeline can have up to {MAX_NODES} steps.")
    try:
        topo_order(graph)
    except PipelineError as e:
        problems.append(str(e))
    by_id = {d.id: d for d in datasets}
    aliases = set(table_names(datasets).values())
    names: dict[str, str] = {}
    for n in nodes:
        t, c, label = step_type(n), config(n), (n.get("data") or {}).get("label") or n["id"]
        if t not in STEP_TYPES:
            problems.append(f'"{label}" has an unknown step type.')
            continue
        name = step_name(n)
        if t not in ("schedule", "destination"):
            if not NAME_RX.match(name):
                problems.append(f'"{label}": its name must be lowercase letters, digits and _ (for example clean_orders).')
            elif name in names:
                problems.append(f'Two steps are called "{name}". Give each its own name.')
            elif name in aliases:
                problems.append(f'"{label}": the name "{name}" is already a dataset table. Choose another name.')
            names[name] = n["id"]
        ups = upstream(graph, n["id"])
        if t == "source":
            if c.get("dataset_id") not in by_id:
                problems.append(f'"{label}": choose a dataset that exists.')
        elif t == "sql":
            sql = (c.get("sql") or "").strip()
            if not sql:
                problems.append(f'"{label}": write the SQL for this step.')
            else:
                try:
                    validate_select(sql)
                except QueryError as e:
                    problems.append(f'"{label}": {e}')
        elif t in ("dedupe", "validate", "destination"):
            if len(ups) != 1:
                problems.append(f'"{label}" needs exactly one incoming connection.')
            if t == "dedupe" and not c.get("keys"):
                problems.append(f'"{label}": choose the columns that identify a duplicate.')
            if t == "validate":
                for chk in c.get("checks") or []:
                    if chk.get("type") not in CHECKS:
                        problems.append(f'"{label}": unknown check "{chk.get("type")}".')
                    if chk.get("type") == "expression":
                        try:
                            validate_select(f"SELECT 1 WHERE {chk.get('sql') or 'TRUE'}")
                        except QueryError as e:
                            problems.append(f'"{label}": {e}')
            if t == "destination":
                if not (c.get("target_name") or "").strip() and not c.get("dataset_id"):
                    problems.append(f'"{label}": name the table to write.')
                if c.get("mode") == "incremental" and not c.get("watermark"):
                    problems.append(f'"{label}": incremental writes need a watermark column (a date or increasing id).')
    return problems


# ---------- step SQL ----------


def step_select(node: dict, graph: dict, nodes: dict[str, dict]) -> str | None:
    """The SELECT that produces this step's rows (None for steps that produce nothing)."""
    t, c = step_type(node), config(node)
    ups = [nodes[u] for u in upstream(graph, node["id"]) if u in nodes]
    src = quote(step_name(ups[0])) if ups else None
    if t == "source":
        cols = c.get("columns")
        sel = ", ".join(quote(x) for x in cols) if cols else "*"
        return f"SELECT {sel} FROM {view_name(c['dataset_id'])}"  # nosec B608 - server-built identifiers
    if t == "sql":
        return c["sql"].strip().rstrip(";")
    if t == "dedupe":
        keys = ", ".join(quote(k) for k in c["keys"])
        order = f"{quote(c['order_by'])} DESC NULLS LAST" if c.get("order_by") else "1"
        return (f"SELECT * EXCLUDE (__vy_rn) FROM (SELECT *, row_number() OVER (PARTITION BY {keys} ORDER BY {order}) AS __vy_rn "
                f"FROM {src}) WHERE __vy_rn = 1")  # nosec B608
    if t == "validate":
        return f"SELECT * FROM {src}"  # nosec B608
    return None


def check_sql(chk: dict, src: str) -> tuple[str, str]:
    """(SQL counting failing rows, SQL predicate a row fails) for one check."""
    col = quote(chk.get("column") or "")
    t = chk["type"]
    if t == "not_null":
        bad = f"{col} IS NULL"
    elif t == "unique":
        return (f"SELECT COALESCE(SUM(n - 1), 0) FROM (SELECT COUNT(*) n FROM {src} GROUP BY {col} HAVING COUNT(*) > 1)",
                f"{col} IN (SELECT {col} FROM {src} GROUP BY {col} HAVING COUNT(*) > 1)")  # nosec B608
    elif t == "accepted_values":
        vals = ", ".join("'" + str(v).replace("'", "''") + "'" for v in (chk.get("values") or [])) or "NULL"
        bad = f"{col} IS NOT NULL AND CAST({col} AS VARCHAR) NOT IN ({vals})"
    elif t == "references":
        ref_table = quote(chk.get("ref_table") or "")
        ref_col = quote(chk.get("ref_column") or chk.get("column") or "")
        bad = f"{col} IS NOT NULL AND {col} NOT IN (SELECT {ref_col} FROM {ref_table} WHERE {ref_col} IS NOT NULL)"
    elif t == "row_count_min":
        n = int(chk.get("min") or 1)
        return f"SELECT CASE WHEN COUNT(*) < {n} THEN 1 ELSE 0 END FROM {src}", "FALSE"  # nosec B608
    else:  # expression: rows must satisfy it
        bad = f"NOT COALESCE(({chk.get('sql') or 'TRUE'}), FALSE)"
    return f"SELECT COUNT(*) FROM {src} WHERE {bad}", bad  # nosec B608


def describe_check(chk: dict) -> str:
    c = chk.get("column")
    return {
        "not_null": f"{c} is never empty",
        "unique": f"{c} is unique",
        "accepted_values": f"{c} is one of {', '.join(map(str, chk.get('values') or []))}",
        "references": f"every {c} exists in {chk.get('ref_table')}.{chk.get('ref_column') or c}",
        "row_count_min": f"at least {chk.get('min') or 1} rows",
        "expression": f"rows satisfy {chk.get('sql')}",
    }.get(chk.get("type"), str(chk.get("type")))


# ---------- running ----------


def run_dir(workspace_id: str, run_id: str) -> Path:
    return Path(workspace_dir(workspace_id)) / "_pipeline_runs" / run_id


class _Log:
    def __init__(self, run: PipelineRun, db: Session):
        self.run, self.db = run, db

    def step(self, node_id: str) -> dict:
        steps = dict(self.run.steps or {})
        return dict(steps.get(node_id) or {"status": "pending", "logs": []})

    def put(self, node_id: str, entry: dict, commit: bool = True) -> None:
        steps = dict(self.run.steps or {})
        steps[node_id] = entry
        self.run.steps = steps
        if commit:
            self.db.commit()

    def line(self, node_id: str, text: str) -> None:
        e = self.step(node_id)
        e["logs"] = [*(e.get("logs") or []), f"{_now().strftime('%H:%M:%S')} {text}"][-50:]
        self.put(node_id, e)


def start_run(db: Session, p: Pipeline, trigger: str, user_id: str | None, only_steps: list[str] | None = None, retry_of: str | None = None, options: dict | None = None) -> PipelineRun:
    """Queue a run. Over the plan's daily run allowance, a person gets 402; a scheduled run is recorded as
    skipped with the reason (and never executed), so the schedule's history shows what happened."""
    from fastapi import HTTPException

    from app import plans

    status, error = "queued", None
    try:
        plans.check_quota(db, plans.org_for_workspace(db, p.workspace_id), "pipeline_runs")
    except HTTPException as e:
        if trigger != "schedule":
            raise
        status, error = "skipped", e.detail["message"][:500]
    run = PipelineRun(workspace_id=p.workspace_id, pipeline_id=p.id, trigger=trigger, status=status, created_by=user_id,
                      only_steps=only_steps, retry_of=retry_of, graph=p.graph, options=options or None, error=error,
                      steps={n["id"]: {"status": "pending", "logs": []} for n in nodes_of(p.graph)})
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def execute(db: Session, run: PipelineRun) -> PipelineRun:
    """Run a queued pipeline run to the end. Errors are recorded on the run and its steps, not raised."""
    if run.status == "skipped":  # over the plan's daily allowance: recorded, not run
        return run
    from app.audit import log_query
    from app.governance import access_for, role_for_user

    if run.status not in ("queued", "retry"):
        return run
    p = db.get(Pipeline, run.pipeline_id)
    if p is None:
        run.status, run.error = "failed", "The pipeline was deleted."
        db.commit()
        return run
    graph = run.graph or p.graph
    log = _Log(run, db)
    run.status, run.started_at = "running", _now()
    db.commit()
    started = time.perf_counter()
    datasets = list(db.scalars(select(Dataset).where(Dataset.workspace_id == run.workspace_id)))
    problems = validate_graph(graph, datasets)
    if problems:
        return _finish(db, run, p, "failed", " ".join(problems[:3]), started)

    nodes = {n["id"]: n for n in nodes_of(graph)}
    order = topo_order(graph)
    reuse: set[str] = set()
    prev: PipelineRun | None = None
    if run.only_steps and run.retry_of:
        prev = db.get(PipelineRun, run.retry_of)
        rerun = downstream_closure(graph, [s for s in run.only_steps if s in nodes])
        reuse = {i for i in order if i not in rerun and prev and (prev.steps or {}).get(i, {}).get("status") == "success"}
    # The person who started it (or created the pipeline) decides what the steps may read.
    role = role_for_user(db, run.workspace_id, run.created_by or p.created_by)
    con = connect(run.workspace_id, datasets, access=access_for(db, run.workspace_id, role))
    out_dir = run_dir(run.workspace_id, run.id)
    out_dir.mkdir(parents=True, exist_ok=True)
    total_written = 0
    failed: str | None = None
    try:
        for node_id in order:
            node = nodes[node_id]
            t, name = step_type(node), step_name(node)
            label = (node.get("data") or {}).get("label") or name
            entry = {"status": "running", "logs": [], "started_at": _now().isoformat()}
            if failed:
                log.put(node_id, {"status": "skipped", "logs": [f"Skipped: an earlier step failed ({failed})."]})
                continue
            if t == "schedule":
                log.put(node_id, {"status": "success", "logs": [f"Run started ({run.trigger})."], "rows": None, "duration_ms": 0})
                continue
            log.put(node_id, entry)
            t0 = time.perf_counter()
            try:
                if node_id in reuse and prev is not None:
                    path = run_dir(run.workspace_id, prev.id) / f"{node_id}.parquet"
                    if not path.exists():
                        raise PipelineError("The earlier result of this step is gone; run the whole pipeline instead.")
                    _load_table(con, name, path)
                    shutil.copyfile(path, out_dir / f"{node_id}.parquet")
                    rows = con.execute(f"SELECT COUNT(*) FROM {quote(name)}").fetchone()[0]  # nosec B608
                    log.line(node_id, f"Reused the result of the earlier run ({rows} rows).")
                    e = log.step(node_id)
                    log.put(node_id, {**e, "status": "success", "rows": rows, "reused": True, "duration_ms": int((time.perf_counter() - t0) * 1000)})
                    continue
                if t == "destination":
                    src = step_name(nodes[upstream(graph, node_id)[0]])
                    written, note = write_destination(db, run, p, node, src, con, datasets)
                    total_written += written
                    log.line(node_id, note)
                    e = log.step(node_id)
                    log.put(node_id, {**e, "status": "success", "rows": written, "duration_ms": int((time.perf_counter() - t0) * 1000)})
                    continue
                sql = step_select(node, graph, nodes)
                if t == "sql":
                    validate_select(sql)
                    if config(node).get("python"):
                        log.line(node_id, "Ran the SQL version of this step (the Python version is for export).")
                con.execute(f"CREATE OR REPLACE TEMP TABLE {quote(name)} AS {sql}")  # nosec B608 - validated SELECT / server-built SQL
                rows = con.execute(f"SELECT COUNT(*) FROM {quote(name)}").fetchone()[0]  # nosec B608
                if rows > get_settings().report_max_rows:
                    raise PipelineError(f"This step produced {rows} rows, more than the {get_settings().report_max_rows} allowed.")
                if t == "validate":
                    rows = run_checks_step(con, node, name, log)
                if t == "dedupe":
                    src = step_name(nodes[upstream(graph, node_id)[0]])
                    before = con.execute(f"SELECT COUNT(*) FROM {quote(src)}").fetchone()[0]  # nosec B608
                    log.line(node_id, f"Removed {before - rows} duplicate rows ({before} → {rows}).")
                _save_table(con, name, out_dir / f"{node_id}.parquet")
                log.line(node_id, f"{label}: {rows} rows.")
                e = log.step(node_id)
                log.put(node_id, {**e, "status": "success", "rows": rows, "duration_ms": int((time.perf_counter() - t0) * 1000)})
            except (PipelineError, QueryError, duckdb.Error, ValueError) as err:
                msg = duckdb_message(err) if isinstance(err, duckdb.Error) else str(err)
                e = log.step(node_id)
                e["logs"] = [*(e.get("logs") or []), f"Error: {msg}"]
                log.put(node_id, {**e, "status": "failed", "error": msg[:1000], "duration_ms": int((time.perf_counter() - t0) * 1000)})
                failed = f'"{label}": {msg}'[:900]
    finally:
        con.close()
    run.rows_written = total_written
    log_query(db, run.workspace_id, run.created_by, "pipeline", started, "error" if failed else "ok", total_written,
              ref_kind="pipeline", ref_id=p.id)
    return _finish(db, run, p, "failed" if failed else "success", failed, started)


def _finish(db: Session, run: PipelineRun, p: Pipeline, status: str, error: str | None, started: float) -> PipelineRun:
    run.status, run.error = status, error
    run.finished_at = _now()
    run.duration_ms = int((time.perf_counter() - started) * 1000)
    p.last_run_at, p.last_status = run.finished_at, status
    db.commit()
    return run


def _save_table(con: duckdb.DuckDBPyConnection, name: str, path: Path) -> None:
    table = con.execute(f"SELECT * FROM {quote(name)}").to_arrow_table()  # nosec B608
    pq.write_table(table, path)


def _load_table(con: duckdb.DuckDBPyConnection, name: str, path: Path) -> None:
    literal = str(path).replace("'", "''")
    con.execute(f"CREATE OR REPLACE TEMP TABLE {quote(name)} AS SELECT * FROM read_parquet('{literal}')")  # nosec B608 - server path


def run_checks_step(con: duckdb.DuckDBPyConnection, node: dict, name: str, log: _Log) -> int:
    """Run a validate step's checks on its temp table. Fails, warns or drops bad rows. Returns rows kept."""
    c = config(node)
    on_fail = c.get("on_fail", "fail")
    src = quote(name)
    bad_preds: list[str] = []
    failures: list[str] = []
    results = []
    for chk in c.get("checks") or []:
        count_sql, pred = check_sql(chk, src)
        n = int(con.execute(count_sql).fetchone()[0] or 0)
        ok = n == 0
        results.append({"check": describe_check(chk), "failed_rows": n, "passed": ok})
        log.line(node["id"], f"{'✓' if ok else '✗'} {describe_check(chk)}" + ("" if ok else f" ({n} rows fail)"))
        if not ok:
            failures.append(f"{describe_check(chk)} ({n} rows)")
            if pred != "FALSE":
                bad_preds.append(f"({pred})")
    e = log.step(node["id"])
    e["checks"] = results
    log.put(node["id"], e)
    if failures and on_fail == "fail":
        raise PipelineError("Checks failed: " + "; ".join(failures))
    if failures and on_fail == "drop" and bad_preds:
        con.execute(f"CREATE OR REPLACE TEMP TABLE {src} AS SELECT * FROM {src} WHERE NOT ({' OR '.join(bad_preds)})")  # nosec B608
        log.line(node["id"], "Dropped the rows that failed.")
    elif failures:
        log.line(node["id"], "Continuing despite failed checks (warn mode).")
    return int(con.execute(f"SELECT COUNT(*) FROM {src}").fetchone()[0])  # nosec B608


def write_destination(db: Session, run: PipelineRun, p: Pipeline, node: dict, src: str, con: duckdb.DuckDBPyConnection,
                      datasets: list[Dataset]) -> tuple[int, str]:
    """Write the upstream step's rows to the target dataset. Returns (rows written, log line)."""
    from app.ingest import profile_frame, write_parquet
    from app.materialize import record_lineage
    from app.routers.datasets import _unique_name, check_quota, parquet_path

    c = config(node)
    mode = c.get("mode", "replace")
    target = db.get(Dataset, c["dataset_id"]) if c.get("dataset_id") else None
    if target is not None and target.workspace_id != run.workspace_id:
        target = None
    if target is None and c.get("target_name"):
        name = c["target_name"].strip()
        target = next((d for d in datasets if d.name == name), None)
    frame = con.execute(f"SELECT * FROM {quote(src)}").df()  # nosec B608
    if len(set(frame.columns)) != len(frame.columns):
        raise PipelineError("Two columns have the same name. Rename one with AS.")
    created = False
    if target is None:
        check_quota(db, run.workspace_id, new_datasets=1)
        target = Dataset(workspace_id=run.workspace_id, created_by=run.created_by, name=_unique_name(db, run.workspace_id, c["target_name"].strip()[:190]),
                         source_filename="Pipeline", source_kind="pipeline", row_count=0, columns=[], file_size=0,
                         layer=c.get("layer"), description=f"Written by the pipeline “{p.name}”.", refresh="manual",
                         origin={"kind": "pipeline", "pipeline_id": p.id})
        db.add(target)
        db.flush()
        created = True
    elif (target.origin or {}).get("pipeline_id") != p.id and mode == "replace" and not (run.options or {}).get("confirm_overwrite"):
        raise PipelineError(f'This would replace the dataset “{target.name}”, which this pipeline didn\'t create. Start the run with “Confirm overwrite” to allow it.')
    path = parquet_path(run.workspace_id, target.id)
    added = len(frame)
    if mode in ("append", "incremental") and path.exists() and not created:
        existing = pd.read_parquet(path)
        if mode == "incremental":
            wm = c["watermark"]
            if wm not in frame.columns:
                raise PipelineError(f'The watermark column "{wm}" isn\'t in the rows being written.')
            if wm in existing.columns and len(existing):
                current = existing[wm].max()
                try:
                    newer = pd.to_datetime(frame[wm], errors="coerce") > pd.to_datetime(current) if not pd.api.types.is_numeric_dtype(frame[wm]) else frame[wm] > current
                except (TypeError, ValueError):
                    newer = frame[wm].astype(str) > str(current)
                frame = frame[newer.fillna(False)]
            added = len(frame)
        common = [col for col in existing.columns if col in frame.columns]
        if set(existing.columns) != set(frame.columns):
            raise PipelineError("The new rows have different columns from the target. Use replace mode once to change its shape.")
        frame = pd.concat([existing[common], frame[common]], ignore_index=True)
    result = profile_frame(frame, get_settings().report_max_rows)
    target.file_size = write_parquet(result.frame, path)
    target.columns = [col.as_dict() for col in result.columns]
    target.row_count = len(result.frame)
    target.layer = c.get("layer") or target.layer
    target.last_synced_at = target.sync_started_at = target.sync_finished_at = _now()
    target.sync_error = None
    sources = _source_datasets(run.graph or p.graph, node["id"], datasets)
    record_lineage(db, target, sources, "pipeline")
    # Remember the target so later runs write the same dataset.
    graph = dict(p.graph or {})
    for n in graph.get("nodes") or []:
        if n.get("id") == node["id"]:
            n.setdefault("data", {}).setdefault("config", {})["dataset_id"] = target.id
    p.graph = {**graph}
    db.commit()
    verb = {"replace": "Replaced", "append": "Appended", "incremental": "Incrementally appended"}.get(mode, "Wrote")
    full = " (full refresh)" if mode == "replace" else ""
    return added, f"{verb} {added} rows into “{target.name}”{full}; it now has {target.row_count} rows."


def _source_datasets(graph: dict, node_id: str, datasets: list[Dataset]) -> list[Dataset]:
    """Datasets read by source steps upstream of a node (for lineage)."""
    from app.materialize import referenced

    nodes = {n["id"]: n for n in nodes_of(graph)}
    seen, q, out = set(), deque([node_id]), {}
    by_id = {d.id: d for d in datasets}
    while q:
        i = q.popleft()
        for u in upstream(graph, i):
            if u in seen or u not in nodes:
                continue
            seen.add(u)
            q.append(u)
            n = nodes[u]
            if step_type(n) == "source" and config(n).get("dataset_id") in by_id:
                out[config(n)["dataset_id"]] = by_id[config(n)["dataset_id"]]
            if step_type(n) == "sql":
                for d in referenced(config(n).get("sql") or "", datasets):
                    out[d.id] = d
    return list(out.values())


def preview_step(db: Session, member, p_graph: dict, node_id: str, limit: int = 50) -> dict:
    """Rows a step would produce, computed now (upstream steps included), without writing anything."""
    from app.governance import connect_as
    from app.query import records

    datasets = list(db.scalars(select(Dataset).where(Dataset.workspace_id == member.workspace_id)))
    graph = p_graph
    nodes = {n["id"]: n for n in nodes_of(graph)}
    if node_id not in nodes:
        raise PipelineError("That step isn't in the pipeline.")
    order = topo_order(graph)
    needed = {node_id}
    q = deque([node_id])
    while q:
        for u in upstream(graph, q.popleft()):
            if u not in needed:
                needed.add(u)
                q.append(u)
    con = connect_as(db, member, datasets)
    started = time.perf_counter()
    try:
        name = None
        for i in order:
            if i not in needed:
                continue
            n = nodes[i]
            t = step_type(n)
            if t in ("schedule",):
                continue
            if t == "destination":
                name = step_name(nodes[upstream(graph, i)[0]])
                continue
            sql = step_select(n, graph, nodes)
            if t == "sql":
                validate_select(sql)
            con.execute(f"CREATE OR REPLACE TEMP TABLE {quote(step_name(n))} AS {sql}")  # nosec B608
            name = step_name(n)
        if name is None:
            return {"columns": [], "rows": [], "row_count": 0, "elapsed_ms": 0}
        total = con.execute(f"SELECT COUNT(*) FROM {quote(name)}").fetchone()[0]  # nosec B608
        cur = con.execute(f"SELECT * FROM {quote(name)} LIMIT {int(limit)}")  # nosec B608
        cols = [d[0] for d in cur.description]
        rows = records(cols, cur.fetchall())
        return {"columns": cols, "rows": rows, "row_count": int(total), "elapsed_ms": int((time.perf_counter() - started) * 1000)}
    except duckdb.Error as e:
        raise PipelineError(duckdb_message(e)) from e
    finally:
        con.close()


def dry_run(db: Session, member, graph: dict) -> dict[str, str]:
    """Bind every step against the real tables without reading rows. {node_id: problem} (empty = all good).

    Proves that every table and column a step uses exists, which is how AI-written steps are checked.
    """
    from app.governance import connect_as

    datasets = list(db.scalars(select(Dataset).where(Dataset.workspace_id == member.workspace_id)))
    problems: dict[str, str] = {}
    nodes = {n["id"]: n for n in nodes_of(graph)}
    try:
        order = topo_order(graph)
    except PipelineError as e:
        return {"__graph__": str(e)}
    con = connect_as(db, member, datasets)
    try:
        for i in order:
            n = nodes[i]
            t = step_type(n)
            if t == "schedule":
                continue
            if any(u in problems for u in upstream(graph, i)):
                problems[i] = "An earlier step has a problem."
                continue
            try:
                if t == "destination":
                    if len(upstream(graph, i)) != 1:
                        raise PipelineError("needs exactly one incoming connection.")
                    src = step_name(nodes[upstream(graph, i)[0]])
                    wm = config(n).get("watermark")
                    if wm:
                        cols = [r[0] for r in con.execute(f"DESCRIBE {quote(src)}").fetchall()]
                        if wm not in cols:
                            raise PipelineError(f'the watermark column "{wm}" isn\'t in its input.')
                    continue
                if t == "source" and config(n).get("dataset_id") not in {d.id for d in datasets}:
                    raise PipelineError("its dataset doesn't exist.")
                if t in ("dedupe", "validate") and len(upstream(graph, i)) != 1:
                    raise PipelineError("needs exactly one incoming connection.")
                sql = step_select(n, graph, nodes)
                if t == "sql":
                    validate_select(sql)
                con.execute(f"CREATE OR REPLACE TEMP TABLE {quote(step_name(n))} AS SELECT * FROM ({sql}) LIMIT 0")  # nosec B608
                if t == "validate":
                    for chk in config(n).get("checks") or []:
                        count_sql, _ = check_sql(chk, quote(step_name(n)))
                        con.execute(count_sql).fetchone()
            except (PipelineError, QueryError, duckdb.Error, KeyError, ValueError) as e:
                problems[i] = duckdb_message(e) if isinstance(e, duckdb.Error) else str(e)
    finally:
        con.close()
    return problems


def layout(graph: dict) -> dict:
    """Place nodes left to right by dependency depth (for AI drafts)."""
    nodes = nodes_of(graph)
    try:
        order = topo_order(graph)
    except PipelineError:
        order = [n["id"] for n in nodes]
    depth: dict[str, int] = {}
    for i in order:
        depth[i] = 1 + max((depth.get(u, 0) for u in upstream(graph, i)), default=-1)
    rows: dict[int, int] = {}
    for n in nodes:
        d = depth.get(n["id"], 0)
        r = rows.get(d, 0)
        rows[d] = r + 1
        n["position"] = {"x": 20 + d * 250, "y": 40 + r * 200}
        n["type"] = "blueprint"
    return graph


# ---------- schedules ----------


def schedule_slot(p: Pipeline, now: datetime) -> datetime | None:
    """The most recent scheduled time at or before `now`, or None for manual pipelines."""
    if not p.enabled or p.schedule == "manual":
        return None
    if p.schedule == "hourly":
        return now.replace(minute=0, second=0, microsecond=0)
    slot = now.replace(hour=p.hour % 24, minute=0, second=0, microsecond=0)
    return slot if slot <= now else slot - timedelta(days=1)


def prune_run_dirs(workspace_root: str, keep_days: int = 7) -> int:
    """Delete saved step results older than `keep_days` (they only serve retries)."""
    cutoff = time.time() - keep_days * 86400
    n = 0
    root = Path(workspace_root)
    if not root.exists():
        return 0
    for ws in root.iterdir():
        runs = ws / "_pipeline_runs"
        if not runs.is_dir():
            continue
        for d in runs.iterdir():
            try:
                if d.stat().st_mtime < cutoff:
                    shutil.rmtree(d, ignore_errors=True)
                    n += 1
            except OSError:
                continue
    return n


# ---------- optimization (rules over the real definitions; no guessing) ----------


def analyze(db: Session, workspace_id: str, p: Pipeline, others: list[Pipeline], datasets: list[Dataset]) -> list[dict]:
    """Suggestions for one pipeline: unnecessary steps, repeated scans, joins, incremental loading, redundancy."""
    from app.materialize import referenced

    out: list[dict] = []
    graph = p.graph or {}
    nodes = nodes_of(graph)
    by_id = {n["id"]: n for n in nodes}
    outgoing = {n["id"]: [e["target"] for e in edges_of(graph) if e["source"] == n["id"]] for n in nodes}
    reads: dict[str, list[str]] = {}
    for n in nodes:
        t, c, label = step_type(n), config(n), (n.get("data") or {}).get("label") or n["id"]
        if t == "source" and c.get("dataset_id"):
            reads.setdefault(c["dataset_id"], []).append(label)
        if t == "sql":
            sql = re.sub(r"\s+", " ", (c.get("sql") or "").strip().lower())
            for d in referenced(c.get("sql") or "", datasets):
                reads.setdefault(d.id, []).append(label)
            ups = upstream(graph, n["id"])
            if ups and re.fullmatch(r"select \* from \"?[a-z0-9_]+\"?;?", sql):
                out.append({"kind": "unnecessary_step", "severity": "low", "node_id": n["id"],
                            "title": f"“{label}” passes rows through unchanged",
                            "detail": "It selects every column of its input with no filter or change. Remove it and connect its input directly."})
            if " join " in f" {sql} " and " on " not in f" {sql} " and " using" not in sql:
                out.append({"kind": "join", "severity": "high", "node_id": n["id"], "title": f"“{label}” has a join without a condition",
                            "detail": "A JOIN without ON or USING multiplies rows (a cross join). Add the matching columns."})
            if "select distinct" in sql and any(step_type(by_id[u]) == "dedupe" for u in ups if u in by_id):
                out.append({"kind": "unnecessary_step", "severity": "low", "node_id": n["id"], "title": f"“{label}” de-duplicates twice",
                            "detail": "Its input already removes duplicates; DISTINCT here does extra work."})
        if t not in ("destination", "schedule") and not outgoing.get(n["id"]):
            out.append({"kind": "unnecessary_step", "severity": "medium", "node_id": n["id"], "title": f"“{label}” isn't used",
                        "detail": "Nothing reads this step's result and it doesn't write a table. Connect it or remove it."})
        if t == "destination" and c.get("mode", "replace") == "replace" and p.schedule in ("hourly", "daily"):
            src_ds = _source_datasets(graph, n["id"], datasets)
            dates = [col["name"] for d in src_ds for col in d.columns if col.get("type") == "date"]
            if dates and any(d.row_count > 50_000 for d in src_ds):
                out.append({"kind": "incremental", "severity": "medium", "node_id": n["id"], "title": f"“{label}” rewrites the whole table every run",
                            "detail": f"The sources have date columns ({', '.join(dates[:3])}). If rows are only ever added, switch to incremental mode with one of them as the watermark."})
    names = {d.id: d.name for d in datasets}
    for ds_id, labels in reads.items():
        if len(labels) > 1:
            out.append({"kind": "repeated_scan", "severity": "medium", "node_id": None,
                        "title": f"“{names.get(ds_id, ds_id)}” is read {len(labels)} times",
                        "detail": f"Steps {', '.join('“' + x + '”' for x in labels)} each scan it. Read it once in a source step and branch from there."})
    mine = _fingerprint(p, datasets)
    for o in others:
        if o.id != p.id and mine and _fingerprint(o, datasets) == mine:
            out.append({"kind": "redundant_pipeline", "severity": "medium", "node_id": None, "title": f"Same work as “{o.name}”",
                        "detail": "Both pipelines read the same datasets and write the same tables. Keep one of them."})
    return out


def _fingerprint(p: Pipeline, datasets: list[Dataset]) -> tuple | None:
    from app.materialize import referenced

    srcs, dests = set(), set()
    for n in nodes_of(p.graph or {}):
        c = config(n)
        if step_type(n) == "source" and c.get("dataset_id"):
            srcs.add(c["dataset_id"])
        if step_type(n) == "sql":
            srcs |= {d.id for d in referenced(c.get("sql") or "", datasets)}
        if step_type(n) == "destination":
            dests.add(c.get("dataset_id") or (c.get("target_name") or "").strip().lower())
    return (tuple(sorted(srcs)), tuple(sorted(dests))) if srcs and dests else None


def cleanup_run_files(workspace_id: str, run_ids: list[str]) -> None:
    for rid in run_ids:
        shutil.rmtree(run_dir(workspace_id, rid), ignore_errors=True)



