"""Workload and cost analysis, from what Vyuham actually measured.

Four kinds of number, never mixed up:
- measured:  durations, rows, storage bytes and AI tokens Vyuham recorded itself.
- scanned:   an upper bound (the Parquet size of the datasets a query read); DuckDB may read less.
- estimated: measured usage × the rates the workspace entered. Zero when no rates are set.
- billed:    Vyuham isn't connected to any cloud bill, so this is always reported as unavailable.
Potential savings are estimates too, and each one names what it assumes.
"""

from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import record_action
from app.auth_tables import user_table
from app.db import get_db
from app.models import (
    AiAction, CostSettings, Dataset, DynamicRefresh, DynamicTable, Pipeline, PipelineRun, Project, QueryExecution, SavedQuery,
    WorkspaceMember,
)
from app.schemas import UtcDatetime
from app.security import current_membership

router = APIRouter(prefix="/usage", tags=["usage"])

GB = 1024 ** 3
LONG_QUERY_MS = 5_000
LONG_RUN_MS = 60_000


class SettingsIO(BaseModel):
    currency: str = Field(default="USD", min_length=3, max_length=3)
    compute_per_hour: float = Field(default=0.0, ge=0, le=10_000)
    storage_per_gb_month: float = Field(default=0.0, ge=0, le=10_000)
    scan_per_gb: float = Field(default=0.0, ge=0, le=10_000)
    ai_input_per_mtok: float = Field(default=0.0, ge=0, le=10_000)
    ai_output_per_mtok: float = Field(default=0.0, ge=0, le=10_000)
    monthly_budget: float | None = Field(default=None, ge=0, le=100_000_000)
    alert_threshold_pct: int = Field(default=80, ge=1, le=100)


class SettingsOut(SettingsIO):
    updated_at: UtcDatetime | None = None


def _settings(db: Session, workspace_id: str) -> CostSettings:
    s = db.get(CostSettings, workspace_id)
    return s or CostSettings(workspace_id=workspace_id, currency="USD", compute_per_hour=0.0, storage_per_gb_month=0.0, scan_per_gb=0.0,
                             ai_input_per_mtok=0.0, ai_output_per_mtok=0.0, monthly_budget=None, alert_threshold_pct=80)


@router.get("/settings", response_model=SettingsOut)
def get_settings_(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    s = _settings(db, member.workspace_id)
    return SettingsOut(**{k: getattr(s, k) for k in SettingsIO.model_fields}, updated_at=s.updated_at)


@router.put("/settings", response_model=SettingsOut)
def put_settings(body: SettingsIO, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    if member.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only owners can change cost rates and budgets.")
    s = db.get(CostSettings, member.workspace_id)
    if s is None:
        s = CostSettings(workspace_id=member.workspace_id)
        db.add(s)
    for k, v in body.model_dump().items():
        setattr(s, k, v.upper() if k == "currency" else v)
    record_action(db, member, "cost_settings.update", "workspace", member.workspace_id, None)
    db.commit()
    db.refresh(s)
    return SettingsOut(**{k: getattr(s, k) for k in SettingsIO.model_fields}, updated_at=s.updated_at)


def _aware(dt: datetime | None) -> datetime | None:
    return None if dt is None else (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc))


def _cost(s: CostSettings, compute_ms: float = 0, scanned: float = 0, storage_bytes: float = 0, months: float = 0,
          tin: float = 0, tout: float = 0) -> float:
    return round(
        compute_ms / 3_600_000 * s.compute_per_hour + scanned / GB * s.scan_per_gb + storage_bytes / GB * months * s.storage_per_gb_month
        + tin / 1e6 * s.ai_input_per_mtok + tout / 1e6 * s.ai_output_per_mtok, 6)


@router.get("/summary")
def summary(days: int = Query(30, ge=1, le=365), member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    if member.role not in ("owner", "editor"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Usage is for owners and editors.")
    ws = member.workspace_id
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    s = _settings(db, ws)
    rates_set = any([s.compute_per_hour, s.storage_per_gb_month, s.scan_per_gb, s.ai_input_per_mtok, s.ai_output_per_mtok])

    queries = db.scalars(select(QueryExecution).where(QueryExecution.workspace_id == ws, QueryExecution.created_at >= since)).all()
    runs = db.scalars(select(PipelineRun).where(PipelineRun.workspace_id == ws, PipelineRun.created_at >= since)).all()
    refreshes = db.scalars(select(DynamicRefresh).where(DynamicRefresh.workspace_id == ws, DynamicRefresh.created_at >= since)).all()
    ai = db.scalars(select(AiAction).where(AiAction.workspace_id == ws, AiAction.created_at >= since)).all()
    datasets = db.scalars(select(Dataset).where(Dataset.workspace_id == ws)).all()
    pipelines = {p.id: p for p in db.scalars(select(Pipeline).where(Pipeline.workspace_id == ws)).all()}
    tables = {t.id: t for t in db.scalars(select(DynamicTable).where(DynamicTable.workspace_id == ws)).all()}
    saved = {q.id: q for q in db.scalars(select(SavedQuery).where(SavedQuery.workspace_id == ws)).all()}
    projects = {p.id: p.name for p in db.scalars(select(Project).where(Project.workspace_id == ws)).all()}
    members = db.scalars(select(WorkspaceMember).where(WorkspaceMember.workspace_id == ws)).all()
    names = {r.id: r.name for r in db.execute(select(user_table.c.id, user_table.c.name).where(user_table.c.id.in_([m.user_id for m in members])))} if members else {}

    # Pipeline and refresh runs log a QueryExecution too; count their time once, from the run records.
    interactive = [q for q in queries if q.kind not in ("pipeline", "dynamic")]
    q_ms = sum(q.duration_ms or 0 for q in interactive)
    p_ms = sum(r.duration_ms or 0 for r in runs)
    r_ms = sum(r.duration_ms or 0 for r in refreshes)
    scanned = sum(q.scanned_bytes or 0 for q in interactive)
    storage = sum(d.file_size or 0 for d in datasets)
    tin = sum(a.input_tokens or 0 for a in ai)
    tout = sum(a.output_tokens or 0 for a in ai)
    failed_ms = sum(q.duration_ms or 0 for q in interactive if q.status == "error") + sum(r.duration_ms or 0 for r in runs if r.status == "failed") \
        + sum(r.duration_ms or 0 for r in refreshes if r.status == "failed")
    months = days / 30.4

    measured = {
        "queries": len(interactive), "query_ms": q_ms, "pipeline_runs": len(runs), "pipeline_ms": p_ms,
        "refreshes": len(refreshes), "refresh_ms": r_ms, "scanned_bytes_upper_bound": scanned, "storage_bytes": storage,
        "datasets": len(datasets), "ai_requests": len(ai), "ai_input_tokens": tin, "ai_output_tokens": tout,
        "ai_requests_without_usage": sum(1 for a in ai if a.input_tokens is None), "failed_ms": failed_ms,
        "notebooks": {"tracked": False, "reason": "Vyuham has no notebooks, so there is no notebook time to measure."},
    }
    est_total = _cost(s, compute_ms=q_ms + p_ms + r_ms, scanned=scanned, storage_bytes=storage, months=months, tin=tin, tout=tout)
    estimated = {
        "rates_set": rates_set, "currency": s.currency, "total": est_total,
        "compute": _cost(s, compute_ms=q_ms + p_ms + r_ms), "scan": _cost(s, scanned=scanned),
        "storage": _cost(s, storage_bytes=storage, months=months), "ai": _cost(s, tin=tin, tout=tout),
        "failed_work": _cost(s, compute_ms=failed_ms),
    }

    # Daily trend.
    trend: dict[str, dict] = {}
    for i in range(days):
        day = (since + timedelta(days=i + 1)).date().isoformat()
        trend[day] = {"day": day, "query_ms": 0, "pipeline_ms": 0, "refresh_ms": 0, "queries": 0, "ai_tokens": 0, "errors": 0}
    def bucket(dt):
        return trend.get(_aware(dt).date().isoformat()) if dt else None
    for q in interactive:
        b = bucket(q.created_at)
        if b:
            b["query_ms"] += q.duration_ms or 0
            b["queries"] += 1
            b["errors"] += q.status == "error"
    for r in runs:
        b = bucket(r.created_at)
        if b:
            b["pipeline_ms"] += r.duration_ms or 0
    for r in refreshes:
        b = bucket(r.created_at)
        if b:
            b["refresh_ms"] += r.duration_ms or 0
    for a in ai:
        b = bucket(a.created_at)
        if b:
            b["ai_tokens"] += (a.input_tokens or 0) + (a.output_tokens or 0)

    # By user.
    by_user: dict[str, dict] = defaultdict(lambda: {"queries": 0, "query_ms": 0, "pipeline_ms": 0, "ai_tokens": 0, "scanned_bytes": 0})
    for q in interactive:
        u = by_user[q.user_id or "system"]
        u["queries"] += 1
        u["query_ms"] += q.duration_ms or 0
        u["scanned_bytes"] += q.scanned_bytes or 0
    for r in runs:
        by_user[r.created_by or "system"]["pipeline_ms"] += r.duration_ms or 0
    for a in ai:
        by_user[a.user_id or "system"]["ai_tokens"] += (a.input_tokens or 0) + (a.output_tokens or 0)
    users = sorted(({"user_id": k, "name": names.get(k, "Scheduled jobs" if k == "system" else "Former member"), **v} for k, v in by_user.items()),
                   key=lambda x: -(x["query_ms"] + x["pipeline_ms"]))

    # By query (fingerprint).
    by_fp: dict[str, dict] = {}
    for q in interactive:
        if not q.fingerprint:
            continue
        e = by_fp.setdefault(q.fingerprint, {"fingerprint": q.fingerprint, "kind": q.kind, "runs": 0, "total_ms": 0, "max_ms": 0, "rows": 0,
                                             "scanned_bytes": 0, "errors": 0, "saved_query_id": None, "users": set(), "last_at": None})
        e["runs"] += 1
        e["total_ms"] += q.duration_ms or 0
        e["max_ms"] = max(e["max_ms"], q.duration_ms or 0)
        e["rows"] += q.rows or 0
        e["scanned_bytes"] += q.scanned_bytes or 0
        e["errors"] += q.status == "error"
        e["users"].add(q.user_id)
        if q.ref_kind == "saved_query" and q.ref_id:
            e["saved_query_id"] = q.ref_id
        e["last_at"] = max(filter(None, [e["last_at"], _aware(q.created_at)]))
    fp_list = []
    for e in by_fp.values():
        sq = saved.get(e["saved_query_id"]) if e["saved_query_id"] else None
        fp_list.append({**e, "users": len(e["users"]), "avg_ms": round(e["total_ms"] / e["runs"]),
                        "name": sq.name if sq else None, "project": projects.get(sq.project_id) if sq and sq.project_id else None,
                        "last_at": e["last_at"].isoformat() if e["last_at"] else None})
    fp_list.sort(key=lambda x: -x["total_ms"])

    # By pipeline / dynamic table.
    by_pipe: dict[str, dict] = {}
    for r in runs:
        e = by_pipe.setdefault(r.pipeline_id, {"pipeline_id": r.pipeline_id, "name": pipelines[r.pipeline_id].name if r.pipeline_id in pipelines else "(deleted)",
                                               "runs": 0, "total_ms": 0, "failed": 0, "rows_written": 0, "max_ms": 0})
        e["runs"] += 1
        e["total_ms"] += r.duration_ms or 0
        e["max_ms"] = max(e["max_ms"], r.duration_ms or 0)
        e["failed"] += r.status == "failed"
        e["rows_written"] += r.rows_written or 0
    by_table: dict[str, dict] = {}
    for r in refreshes:
        e = by_table.setdefault(r.table_id, {"table_id": r.table_id, "name": tables[r.table_id].name if r.table_id in tables else "(deleted)",
                                             "refreshes": 0, "total_ms": 0, "failed": 0, "incremental": 0, "max_ms": 0})
        e["refreshes"] += 1
        e["total_ms"] += r.duration_ms or 0
        e["max_ms"] = max(e["max_ms"], r.duration_ms or 0)
        e["failed"] += r.status == "failed"
        e["incremental"] += r.mode == "incremental"

    # By project.
    by_project: dict[str, dict] = defaultdict(lambda: {"query_ms": 0, "pipeline_ms": 0, "refresh_ms": 0})
    for q in interactive:
        if q.ref_kind == "saved_query" and q.ref_id in saved:
            by_project[saved[q.ref_id].project_id or "none"]["query_ms"] += q.duration_ms or 0
        else:
            by_project["none"]["query_ms"] += q.duration_ms or 0
    for r in runs:
        p = pipelines.get(r.pipeline_id)
        by_project[(p.project_id if p else None) or "none"]["pipeline_ms"] += r.duration_ms or 0
    for r in refreshes:
        t = tables.get(r.table_id)
        by_project[(t.project_id if t else None) or "none"]["refresh_ms"] += r.duration_ms or 0
    project_list = sorted(({"project_id": None if k == "none" else k, "name": "No project" if k == "none" else projects.get(k, "(deleted)"),
                            **v, "total_ms": sum(v.values())} for k, v in by_project.items()), key=lambda x: -x["total_ms"])

    # By dataset: storage, reads and an upper bound on bytes scanned.
    reads: dict[str, int] = defaultdict(int)
    last_read: dict[str, datetime] = {}
    for q in queries:
        for i in q.dataset_ids or []:
            reads[i] += 1
            at = _aware(q.created_at)
            if i not in last_read or at > last_read[i]:
                last_read[i] = at
    dataset_list = sorted(({"dataset_id": d.id, "name": d.name, "layer": d.layer, "storage_bytes": d.file_size or 0, "rows": d.row_count,
                            "reads": reads.get(d.id, 0), "scanned_bytes": reads.get(d.id, 0) * (d.file_size or 0),
                            "last_read_at": last_read[d.id].isoformat() if d.id in last_read else None,
                            "storage_cost_month": _cost(s, storage_bytes=d.file_size or 0, months=1)} for d in datasets),
                          key=lambda x: -x["storage_bytes"])

    # Ranking: the most time-consuming operations, each with what could be done about it.
    ranking = []
    for e in fp_list[:20]:
        tip = None
        if e["runs"] >= 5 and e["avg_ms"] >= 1000:
            tip = f"Runs {e['runs']} times at ~{e['avg_ms'] / 1000:.1f}s. Save its result as a dynamic table and query that instead."
        elif e["max_ms"] >= LONG_QUERY_MS:
            tip = "One run took over 5 seconds. Check its plan in the SQL Workbench, filter earlier or select fewer columns."
        elif e["errors"]:
            tip = f"Failed {e['errors']} of {e['runs']} times; failed runs still use time."
        ranking.append({"kind": "query", "id": e["fingerprint"], "name": e["name"] or f"Query {e['fingerprint'][:6]}", "total_ms": e["total_ms"],
                        "runs": e["runs"], "avg_ms": e["avg_ms"], "opportunity": tip, "estimated_cost": _cost(s, compute_ms=e["total_ms"], scanned=e["scanned_bytes"])})
    for e in by_pipe.values():
        tip = None
        p = pipelines.get(e["pipeline_id"])
        if e["failed"]:
            tip = f"{e['failed']} of {e['runs']} runs failed. Open the run and use “Debug with AI”."
        elif p and any((n.get("data", {}).get("config") or {}).get("type") == "destination" and (n.get("data", {}).get("config") or {}).get("mode", "replace") == "replace"
                       for n in (p.graph or {}).get("nodes", [])) and e["runs"] >= 7:
            tip = "Rewrites its target on every run. If sources only grow, an incremental destination does less work."
        ranking.append({"kind": "pipeline", "id": e["pipeline_id"], "name": e["name"], "total_ms": e["total_ms"], "runs": e["runs"],
                        "avg_ms": round(e["total_ms"] / max(e["runs"], 1)), "opportunity": tip, "estimated_cost": _cost(s, compute_ms=e["total_ms"])})
    for e in by_table.values():
        tip = None
        t = tables.get(e["table_id"])
        if e["failed"]:
            tip = f"{e['failed']} refreshes failed."
        elif t and t.refresh_mode == "full" and t.watermark_column is None and e["refreshes"] >= 24:
            tip = "Refreshes in full often. If its sources only grow, incremental refresh with a watermark column does less work."
        elif t and t.interval_minutes and reads.get(t.dataset_id, 0) < e["refreshes"] / 10:
            tip = f"Refreshed {e['refreshes']} times but read {reads.get(t.dataset_id, 0)} times. A longer interval would do."
        ranking.append({"kind": "dynamic_table", "id": e["table_id"], "name": e["name"], "total_ms": e["total_ms"], "runs": e["refreshes"],
                        "avg_ms": round(e["total_ms"] / max(e["refreshes"], 1)), "opportunity": tip, "estimated_cost": _cost(s, compute_ms=e["total_ms"])})
    ranking.sort(key=lambda x: -x["total_ms"])

    long_running = sorted(
        [{"kind": "query", "name": (saved[q.ref_id].name if q.ref_kind == "saved_query" and q.ref_id in saved else f"{q.kind} query"),
          "duration_ms": q.duration_ms, "status": q.status, "at": _aware(q.created_at).isoformat(), "user": names.get(q.user_id or "", None)}
         for q in interactive if (q.duration_ms or 0) >= LONG_QUERY_MS]
        + [{"kind": "pipeline", "name": pipelines[r.pipeline_id].name if r.pipeline_id in pipelines else "(deleted)", "duration_ms": r.duration_ms,
            "status": r.status, "at": _aware(r.created_at).isoformat(), "user": names.get(r.created_by or "", None)}
           for r in runs if (r.duration_ms or 0) >= LONG_RUN_MS]
        + [{"kind": "dynamic_table", "name": tables[r.table_id].name if r.table_id in tables else "(deleted)", "duration_ms": r.duration_ms,
            "status": r.status, "at": _aware(r.created_at).isoformat(), "user": None}
           for r in refreshes if (r.duration_ms or 0) >= LONG_RUN_MS],
        key=lambda x: -(x["duration_ms"] or 0))[:25]

    repeated = [e for e in fp_list if e["runs"] >= 5 and e["avg_ms"] >= 1000][:15]

    # Idle resources: stored but not read, and scheduled work nobody uses.
    idle_cutoff = now - timedelta(days=30)
    upstream_of = {i for t in tables.values() for i in (t.upstream_ids or [])}
    idle = []
    for d in datasets:
        created = _aware(d.created_at)
        if created and created > idle_cutoff:
            continue
        lr = last_read.get(d.id)
        if (lr is None or lr < idle_cutoff) and d.id not in upstream_of:
            idle.append({"kind": "dataset", "id": d.id, "name": d.name, "storage_bytes": d.file_size or 0,
                         "detail": "Not read by any query in the last 30 days" if days >= 30 else f"Not read in the last {days} days (look at 30 days for a firmer answer)",
                         "monthly_cost": _cost(s, storage_bytes=d.file_size or 0, months=1)})
    for t in tables.values():
        if t.paused:
            idle.append({"kind": "dynamic_table", "id": t.id, "name": t.name, "storage_bytes": 0, "detail": "Paused: its data is getting older", "monthly_cost": 0})
        elif t.interval_minutes and reads.get(t.dataset_id, 0) == 0 and by_table.get(t.id, {}).get("refreshes", 0) >= 5:
            idle.append({"kind": "dynamic_table", "id": t.id, "name": t.name, "storage_bytes": 0,
                         "detail": f"Refreshed {by_table[t.id]['refreshes']} times, read 0 times", "monthly_cost": _cost(s, compute_ms=by_table[t.id]["total_ms"] / months)})
    for p in pipelines.values():
        if p.enabled and p.schedule != "manual" and by_pipe.get(p.id, {}).get("runs", 0) and by_pipe[p.id]["failed"] == by_pipe[p.id]["runs"]:
            idle.append({"kind": "pipeline", "id": p.id, "name": p.name, "storage_bytes": 0, "detail": "Scheduled, and every run failed", "monthly_cost": 0})

    # Potential savings (estimates, each with its assumption).
    savings = []
    for e in repeated:
        saved_ms = e["total_ms"] - e["max_ms"]  # materialize once, then read a small table
        savings.append({"what": f"Materialize “{e['name'] or 'query ' + e['fingerprint'][:6]}”", "measured_ms": saved_ms,
                        "estimated": _cost(s, compute_ms=saved_ms, scanned=e["scanned_bytes"] * (e["runs"] - 1) / max(e["runs"], 1)),
                        "assumes": "Reading the stored result takes almost no time compared with re-running the query."})
    for i in idle:
        if i["kind"] == "dataset" and i["storage_bytes"]:
            savings.append({"what": f"Delete or archive “{i['name']}”", "measured_ms": 0, "estimated": i["monthly_cost"],
                            "assumes": "Nobody needs it; the figure is per month of storage."})
    failed_cost = estimated["failed_work"]
    if failed_ms:
        savings.append({"what": "Fix failing runs", "measured_ms": failed_ms, "estimated": failed_cost,
                        "assumes": "Failed work is redone after the fix, so only the failed attempts are saved."})

    # Budget (calendar month, estimated).
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    mq = [q for q in interactive if _aware(q.created_at) >= month_start]
    m_ms = sum(q.duration_ms or 0 for q in mq) + sum(r.duration_ms or 0 for r in runs if _aware(r.created_at) >= month_start) \
        + sum(r.duration_ms or 0 for r in refreshes if _aware(r.created_at) >= month_start)
    m_ai = [a for a in ai if _aware(a.created_at) >= month_start]
    elapsed = max((now - month_start).total_seconds() / 86400, 1 / 24)
    dim = calendar.monthrange(now.year, now.month)[1]
    mtd = _cost(s, compute_ms=m_ms, scanned=sum(q.scanned_bytes or 0 for q in mq), storage_bytes=storage, months=elapsed / 30.4,
                tin=sum(a.input_tokens or 0 for a in m_ai), tout=sum(a.output_tokens or 0 for a in m_ai))
    projected = round(mtd / elapsed * dim, 2)
    budget = None
    if s.monthly_budget:
        pct = projected / s.monthly_budget * 100 if s.monthly_budget else 0
        budget = {"monthly_budget": s.monthly_budget, "month_to_date": mtd, "projected": projected, "projected_pct": round(pct, 1),
                  "threshold_pct": s.alert_threshold_pct,
                  "status": "over" if pct >= 100 else "warn" if pct >= s.alert_threshold_pct else "ok"}

    suggestions = []
    if repeated:
        suggestions.append(f"{len(repeated)} expensive queries run again and again. Materializing them as dynamic tables saves the most time.")
    if any(r["kind"] == "pipeline" and r["opportunity"] for r in ranking):
        suggestions.append("Some pipelines fail or rewrite whole tables; see the ranking for which.")
    if idle:
        suggestions.append(f"{len(idle)} resources look idle. Review them before deleting anything.")
    if not rates_set:
        suggestions.append("Enter your infrastructure rates to turn measured usage into estimated cost.")

    return {
        "period_days": days, "generated_at": now.isoformat(),
        "billed": {"available": False, "reason": "Vyuham isn't connected to a cloud bill. Figures below are measured usage and estimates from your rates."},
        "measured": measured, "estimated": estimated, "budget": budget, "trend": list(trend.values()),
        "by_user": users, "by_project": project_list, "by_query": fp_list[:50], "by_pipeline": sorted(by_pipe.values(), key=lambda x: -x["total_ms"]),
        "by_dynamic_table": sorted(by_table.values(), key=lambda x: -x["total_ms"]), "by_dataset": dataset_list[:100],
        "ranking": ranking[:30], "long_running": long_running, "repeated_expensive": repeated, "idle": idle,
        "savings": sorted(savings, key=lambda x: -x["estimated"]), "suggestions": suggestions,
    }
