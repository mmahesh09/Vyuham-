"""Pipelines (ETL/ELT builder) and the AI Data Engineer.

Approval rules:
- A pipeline drafted or changed by the AI is marked `generated_by_ai` and can't run (manually or on its
  schedule) until someone approves it. Any later AI change clears the approval.
- A run that would replace a dataset the pipeline didn't create needs `confirm_overwrite`.
Runs are queued for the background worker and polled; nothing executes inside the request.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import plans
from app import pipelines as engine
from app.ai import ENGINE_NOTES, AiError, AiUnavailable, ask_json, schema_context, update_output
from app.audit import record_action
from app.db import get_db
from app.governance import redact_error_values, redact_text
from app.jobs import PIPELINE_RUN, Due, _second, dispatch
from app.models import AiAction, Dataset, Pipeline, PipelineRun, WorkspaceMember
from app.routers.datasets import require_editor
from app.routers.sql_lab import check_project
from app.schemas import UtcDatetime
from app.security import current_membership

router = APIRouter(prefix="/pipelines", tags=["pipelines"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


class PipelineIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    graph: dict[str, Any] = Field(default_factory=lambda: {"nodes": [], "edges": []})
    schedule: Literal["manual", "hourly", "daily"] = "manual"
    hour: int = Field(default=6, ge=0, le=23)
    enabled: bool = True
    project_id: str | None = None
    # Set when the graph came from the AI (a draft or a suggested fix): the pipeline then needs approval.
    ai_action_id: str | None = None


class PipelineOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    name: str
    description: str | None
    graph: dict
    schedule: str
    hour: int
    enabled: bool
    project_id: str | None
    generated_by_ai: bool
    approved_at: UtcDatetime | None
    last_run_at: UtcDatetime | None
    last_status: str | None
    created_at: UtcDatetime
    updated_at: UtcDatetime
    problems: list[str] = []
    needs_approval: bool = False


class RunOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    pipeline_id: str
    trigger: str
    status: str
    steps: dict
    only_steps: list | None
    retry_of: str | None
    error: str | None
    rows_written: int | None
    duration_ms: int | None
    created_at: UtcDatetime
    started_at: UtcDatetime | None
    finished_at: UtcDatetime | None


def _datasets(db: Session, member: WorkspaceMember) -> list[Dataset]:
    from app.governance import visible_datasets

    return visible_datasets(db, member, list(db.scalars(select(Dataset).where(Dataset.workspace_id == member.workspace_id))))


def _out(db: Session, p: Pipeline, datasets: list[Dataset]) -> PipelineOut:
    out = PipelineOut.model_validate(p)
    out.problems = engine.validate_graph(p.graph, datasets)
    out.needs_approval = p.generated_by_ai and p.approved_at is None
    return out


def _pipeline(db: Session, member: WorkspaceMember, pid: str) -> Pipeline:
    p = db.get(Pipeline, pid)
    if p is None or p.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pipeline not found")
    return p


def _clean_graph(graph: dict) -> dict:
    nodes = engine.nodes_of(graph)[: engine.MAX_NODES + 1]
    ids = {n["id"] for n in nodes}
    edges = [e for e in engine.edges_of(graph) if e["source"] in ids and e["target"] in ids]
    return {"nodes": nodes, "edges": edges}


def _ai_action(db: Session, member: WorkspaceMember, action_id: str | None) -> AiAction | None:
    if not action_id:
        return None
    a = db.get(AiAction, action_id)
    if a is None or a.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That AI suggestion wasn't found.")
    return a


@router.get("", response_model=list[PipelineOut])
def list_pipelines(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    ds = _datasets(db, member)
    rows = db.scalars(select(Pipeline).where(Pipeline.workspace_id == member.workspace_id).order_by(Pipeline.updated_at.desc())).all()
    return [_out(db, p, ds) for p in rows]


@router.post("", response_model=PipelineOut, status_code=status.HTTP_201_CREATED)
def create_pipeline(body: PipelineIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    if body.schedule != "manual":
        plans.require_feature(db, member, "engineering.pipeline_scheduling")
    action = _ai_action(db, member, body.ai_action_id)
    p = Pipeline(workspace_id=member.workspace_id, name=body.name.strip(), description=body.description, graph=_clean_graph(body.graph),
                 schedule=body.schedule, hour=body.hour, enabled=body.enabled, project_id=check_project(db, member, body.project_id),
                 generated_by_ai=action is not None, created_by=member.user_id)
    db.add(p)
    db.flush()
    if action is not None:
        action.ref_kind, action.ref_id, action.outcome = "pipeline", p.id, "applied"
    record_action(db, member, "pipeline.create", "pipeline", p.id, {"ai": action is not None})
    db.commit()
    db.refresh(p)
    return _out(db, p, _datasets(db, member))


@router.get("/{pid}", response_model=PipelineOut)
def get_pipeline(pid: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return _out(db, _pipeline(db, member, pid), _datasets(db, member))


@router.put("/{pid}", response_model=PipelineOut)
def update_pipeline(pid: str, body: PipelineIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    if body.schedule != "manual":
        plans.require_feature(db, member, "engineering.pipeline_scheduling")
    p = _pipeline(db, member, pid)
    action = _ai_action(db, member, body.ai_action_id)
    p.name, p.description, p.graph = body.name.strip(), body.description, _clean_graph(body.graph)
    p.schedule, p.hour, p.enabled = body.schedule, body.hour, body.enabled
    p.project_id = check_project(db, member, body.project_id)
    if action is not None:  # an AI change needs a fresh approval
        p.generated_by_ai, p.approved_at, p.approved_by = True, None, None
        action.ref_kind, action.ref_id, action.outcome = "pipeline", p.id, "applied"
    db.commit()
    db.refresh(p)
    return _out(db, p, _datasets(db, member))


@router.delete("/{pid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pipeline(pid: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Deletes the pipeline and its run history. Datasets it wrote are kept."""
    require_editor(member)
    p = _pipeline(db, member, pid)
    run_ids = [r for r in db.scalars(select(PipelineRun.id).where(PipelineRun.pipeline_id == p.id))]
    for r in db.scalars(select(PipelineRun).where(PipelineRun.pipeline_id == p.id)).all():
        db.delete(r)
    record_action(db, member, "pipeline.delete", "pipeline", p.id, None)
    db.delete(p)
    db.commit()
    engine.cleanup_run_files(member.workspace_id, run_ids)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{pid}/approve", response_model=PipelineOut)
def approve(pid: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """A person reviewed the AI-generated steps and allows them to run."""
    require_editor(member)
    p = _pipeline(db, member, pid)
    problems = engine.validate_graph(p.graph, _datasets(db, member))
    if problems:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Fix these first: " + " ".join(problems[:3]))
    p.approved_at, p.approved_by = _now(), member.user_id
    for a in db.scalars(select(AiAction).where(AiAction.ref_kind == "pipeline", AiAction.ref_id == p.id, AiAction.outcome == "applied")).all():
        a.outcome = "approved"
    record_action(db, member, "pipeline.approve", "pipeline", p.id, None)
    db.commit()
    db.refresh(p)
    return _out(db, p, _datasets(db, member))


# ---------- preview / check ----------


class PreviewIn(BaseModel):
    graph: dict[str, Any]
    node_id: str
    limit: int = Field(default=50, ge=1, le=200)


@router.post("/preview")
def preview(body: PreviewIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Rows one step would produce now (its upstream steps are computed too). Writes nothing."""
    require_editor(member)
    try:
        return engine.preview_step(db, member, _clean_graph(body.graph), body.node_id, body.limit)
    except (engine.PipelineError, ValueError) as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e


class CheckIn(BaseModel):
    graph: dict[str, Any]


@router.post("/check")
def check(body: CheckIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Definition problems and a dry run of every step against the real tables."""
    require_editor(member)
    g = _clean_graph(body.graph)
    return {"problems": engine.validate_graph(g, _datasets(db, member)), "steps": engine.dry_run(db, member, g)}


# ---------- runs ----------


class StartIn(BaseModel):
    only_steps: list[str] | None = Field(default=None, max_length=engine.MAX_NODES)
    retry_of: str | None = None
    confirm_overwrite: bool = False


@router.post("/{pid}/runs", response_model=RunOut, status_code=status.HTTP_202_ACCEPTED)
def start(pid: str, body: StartIn, background: BackgroundTasks, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    p = _pipeline(db, member, pid)
    if p.generated_by_ai and p.approved_at is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Review and approve the AI-generated steps before running this pipeline.")
    problems = engine.validate_graph(p.graph, _datasets(db, member))
    if problems:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, " ".join(problems[:3]))
    running = db.scalar(select(PipelineRun.id).where(PipelineRun.pipeline_id == p.id, PipelineRun.status.in_(("queued", "running"))))
    if running:
        raise HTTPException(status.HTTP_409_CONFLICT, "This pipeline is already running.")
    if body.retry_of:
        prev = db.get(PipelineRun, body.retry_of)
        if prev is None or prev.pipeline_id != p.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    run = engine.start_run(db, p, "retry" if body.retry_of else "manual", member.user_id, body.only_steps, body.retry_of,
                           {"confirm_overwrite": True} if body.confirm_overwrite else None)
    record_action(db, member, "pipeline.run", "pipeline", p.id, {"run": run.id, "retry": bool(body.retry_of), "confirm_overwrite": body.confirm_overwrite})
    db.commit()
    dispatch(db, Due(PIPELINE_RUN, run.id, _second(_now())), background)
    return run


@router.get("/{pid}/runs", response_model=list[RunOut])
def list_runs(pid: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    p = _pipeline(db, member, pid)
    return db.scalars(select(PipelineRun).where(PipelineRun.pipeline_id == p.id).order_by(PipelineRun.created_at.desc()).limit(50)).all()


@router.get("/{pid}/runs/{rid}", response_model=RunOut)
def get_run(pid: str, rid: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    p = _pipeline(db, member, pid)
    r = db.get(PipelineRun, rid)
    if r is None or r.pipeline_id != p.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    return r


@router.get("/{pid}/optimize")
def optimize(pid: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Rule-based suggestions from the pipeline's real definition and the workspace's datasets."""
    p = _pipeline(db, member, pid)
    others = db.scalars(select(Pipeline).where(Pipeline.workspace_id == member.workspace_id)).all()
    return {"suggestions": engine.analyze(db, member.workspace_id, p, list(others), _datasets(db, member))}


# ---------- AI Data Engineer ----------

STEP_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string", "description": "short unique id like s1"},
        "type": {"type": "string", "enum": ["schedule", "source", "sql", "dedupe", "validate", "destination"]},
        "label": {"type": "string"},
        "name": {"type": "string", "description": "lowercase identifier other steps use in SQL; not a dataset table name"},
        "explanation": {"type": "string"},
        "layer": {"type": "string", "enum": ["bronze", "silver", "gold", ""]},
        "table": {"type": "string", "description": "source steps: the dataset table name to read, exactly as listed"},
        "sql": {"type": "string", "description": "sql steps: one DuckDB SELECT over upstream step names and/or dataset tables"},
        "python": {"type": "string", "description": "sql steps: the same transformation in pandas, for export"},
        "keys": {"type": "array", "items": {"type": "string"}},
        "order_by": {"type": "string"},
        "checks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": ["not_null", "unique", "accepted_values", "references", "row_count_min", "expression"]},
                    "column": {"type": "string"},
                    "values": {"type": "array", "items": {"type": "string"}},
                    "ref_table": {"type": "string"},
                    "ref_column": {"type": "string"},
                    "min": {"type": "integer"},
                    "sql": {"type": "string"},
                },
                "required": ["type", "column", "values", "ref_table", "ref_column", "min", "sql"],
                "additionalProperties": False,
            },
        },
        "on_fail": {"type": "string", "enum": ["fail", "warn", "drop"]},
        "target_name": {"type": "string"},
        "mode": {"type": "string", "enum": ["replace", "append", "incremental"]},
        "watermark": {"type": "string"},
    },
    "required": ["id", "type", "label", "name", "explanation", "layer", "table", "sql", "python", "keys", "order_by", "checks",
                 "on_fail", "target_name", "mode", "watermark"],
    "additionalProperties": False,
}
PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "understanding": {"type": "string"},
        "name": {"type": "string"},
        "feasible": {"type": "boolean"},
        "missing": {"type": "array", "items": {"type": "string"}, "description": "data the request needs that isn't in the workspace"},
        "steps": {"type": "array", "items": STEP_SCHEMA},
        "edges": {"type": "array", "items": {"type": "array", "items": {"type": "string"}}},
        "schedule": {"type": "string", "enum": ["manual", "hourly", "daily"]},
        "hour": {"type": "integer"},
        "design": {"type": "string", "description": "why the pipeline is shaped this way: layers, checks, joins, loading"},
        "incremental": {"type": "string", "description": "whether incremental loading fits and why"},
    },
    "required": ["understanding", "name", "feasible", "missing", "steps", "edges", "schedule", "hour", "design", "incremental"],
    "additionalProperties": False,
}

PLAN_SYSTEM = """You are Vyuham's AI Data Engineer. You design ETL/ELT pipelines as a DAG of steps.

Step types:
- schedule: the start of the pipeline (one, first).
- source: reads one dataset table (set `table` to its exact name from the list).
- sql: one read-only DuckDB SELECT. It reads upstream steps by their `name` and may also read dataset tables directly.
- dedupe: keeps one row per `keys` (latest by `order_by` when given). Exactly one input.
- validate: data quality checks on its single input; `on_fail` fail stops the run, warn logs, drop removes failing rows.
  Check types: not_null(column), unique(column), accepted_values(column, values), references(column, ref_table, ref_column: the
  ref_table is a step name or dataset table), row_count_min(min), expression(sql: a boolean condition each row must meet).
- destination: writes its single input to a managed dataset `target_name` with `layer` and `mode` (replace = full refresh,
  append, incremental = append rows newer than `watermark`).

Rules:
- Use only the tables and columns listed below. Never invent a table or a column. If something the request needs is missing,
  set feasible to false and list it in `missing`, and design only what the data supports.
- Organise steps into Bronze (raw reads), Silver (cleaned, de-duplicated, validated) and Gold (business aggregates) layers.
- Add validation where the request implies it, plus sensible checks on keys.
- Recommend incremental loading only when a source has a date or increasing id column and rows are appended.
- Every step needs a one or two sentence `explanation`. Fill unused fields with empty strings, empty lists, 0 or "fail"/"replace".
- `edges` is a list of [from_id, to_id] pairs.
- Step names must be unique lowercase identifiers and must not equal a dataset table name.
""" + ENGINE_NOTES


class PlanIn(BaseModel):
    request: str = Field(min_length=5, max_length=3000)


def _to_graph(plan: dict, tables: list[dict]) -> tuple[dict, list[str]]:
    """Turn the AI's steps into a canvas graph. Unknown tables are reported, never guessed."""
    by_table = {t["table"]: t for t in tables}
    nodes, notes = [], []
    for s in plan.get("steps") or []:
        t = s.get("type")
        c: dict[str, Any] = {"type": t, "name": engine.slug(s.get("name") or s.get("label") or s["id"]) if t not in ("schedule", "destination") else None}
        if s.get("layer"):
            c["layer"] = s["layer"]
        if t == "source":
            tbl = by_table.get(s.get("table") or "")
            if tbl is None:
                notes.append(f'“{s.get("label")}” reads “{s.get("table")}”, which isn\'t a table in this workspace.')
            c["dataset_id"] = tbl["dataset_id"] if tbl else None
        elif t == "sql":
            c["sql"], c["python"] = s.get("sql") or "", s.get("python") or ""
        elif t == "dedupe":
            c["keys"], c["order_by"] = s.get("keys") or [], s.get("order_by") or None
        elif t == "validate":
            c["on_fail"] = s.get("on_fail") or "fail"
            c["checks"] = [{k: v for k, v in chk.items() if v not in ("", [], 0) or k in ("type", "column")} for chk in s.get("checks") or []]
        elif t == "destination":
            c["target_name"], c["mode"] = s.get("target_name") or "", s.get("mode") or "replace"
            c["layer"] = s.get("layer") or "gold"
            if s.get("watermark"):
                c["watermark"] = s["watermark"]
        c = {k: v for k, v in c.items() if v is not None}
        nodes.append({"id": s["id"], "type": "blueprint", "position": {"x": 0, "y": 0}, "data": {
            "label": (s.get("label") or s["id"])[:60], "detail": (s.get("explanation") or "")[:160], "kind": engine.KIND_FOR.get(t, "agent"),
            "tool": (c.get("layer") or t or "").capitalize(), "config": c, "explanation": s.get("explanation") or "",
        }})
    ids = {n["id"] for n in nodes}
    edges = [{"id": f"e-{a}-{b}", "source": a, "target": b, "type": "blueprint"} for a, b in (tuple(e[:2]) for e in plan.get("edges") or [] if len(e) >= 2)
             if a in ids and b in ids]
    return engine.layout({"nodes": nodes, "edges": edges}), notes


@router.post("/ai/plan")
def ai_plan(body: PlanIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Draft a pipeline from a plain-English request. Nothing is saved or run: the person previews, saves and approves it."""
    require_editor(member)
    plans.require_feature(db, member, "engineering.ai_pipeline_generation")
    datasets = _datasets(db, member)
    schema_text, tables = schema_context(db, member, datasets)
    system = f"{PLAN_SYSTEM}\n\nDataset tables in this workspace:\n{schema_text}"
    prompt = f"Request: {redact_text(body.request)}"
    try:
        r = ask_json(db, member, "pipeline_plan", system, prompt, PLAN_SCHEMA, effort="high", max_tokens=32000)
        graph, notes = _to_graph(r.data, tables)
        problems = engine.validate_graph(graph, datasets) + notes
        steps = engine.dry_run(db, member, graph)
        if problems or steps:
            issues = "\n".join(problems + [f"step {k}: {v}" for k, v in steps.items()])
            r2 = ask_json(db, member, "pipeline_plan", system,
                          f"{prompt}\n\nYour previous design failed the workspace check:\n{redact_text(issues)}\n"
                          f"Previous steps: {r.data.get('steps')}\nReturn a corrected design.", PLAN_SCHEMA, effort="high", max_tokens=32000)
            graph2, notes2 = _to_graph(r2.data, tables)
            problems2 = engine.validate_graph(graph2, datasets) + notes2
            steps2 = engine.dry_run(db, member, graph2)
            r, graph, problems, steps = r2, graph2, problems2, steps2
    except AiUnavailable as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e)) from e
    except AiError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e
    result = {
        "action_id": r.action.id,
        "name": r.data.get("name") or "New pipeline",
        "understanding": r.data["understanding"],
        "feasible": r.data["feasible"] and not problems and not steps,
        "missing": r.data.get("missing") or [],
        "design": r.data["design"],
        "incremental": r.data["incremental"],
        "schedule": r.data.get("schedule") or "manual",
        "hour": max(0, min(23, int(r.data.get("hour") or 6))),
        "graph": graph,
        "problems": problems,
        "step_problems": steps,
        "used_tables": sorted({t["name"] for t in tables if any(engine.config(n).get("dataset_id") == t["dataset_id"] for n in graph["nodes"])}),
    }
    update_output(db, r.action, {k: v for k, v in result.items() if k != "action_id"})
    return result


DEBUG_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "failed_step": {"type": "string"},
        "cause": {"type": "string"},
        "fix": {"type": "string"},
        "node_id": {"type": "string", "description": "id of the step to change, or empty"},
        "corrected_sql": {"type": "string", "description": "for a sql step: the corrected SELECT, or empty"},
        "corrected_config": {"type": "string", "description": "for other steps: corrected config as JSON text, or empty"},
    },
    "required": ["summary", "failed_step", "cause", "fix", "node_id", "corrected_sql", "corrected_config"],
    "additionalProperties": False,
}


@router.post("/{pid}/runs/{rid}/debug")
def ai_debug(pid: str, rid: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Read a failed run's logs and the failing step, explain the error and propose a checked fix (not applied)."""
    import json

    require_editor(member)
    plans.require_feature(db, member, "engineering.pipeline_debugging")
    p = _pipeline(db, member, pid)
    run = db.get(PipelineRun, rid)
    if run is None or run.pipeline_id != p.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    if run.status != "failed":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Only failed runs can be debugged.")
    graph = run.graph or p.graph
    failed = [nid for nid, s in (run.steps or {}).items() if s.get("status") == "failed"]
    nodes = {n["id"]: n for n in engine.nodes_of(graph)}
    lines = []
    for nid, s in (run.steps or {}).items():
        n = nodes.get(nid)
        if not n:
            continue
        lines.append(f"- step {nid} “{n['data'].get('label')}” ({engine.step_type(n)}, name {engine.step_name(n)}): {s.get('status')}"
                     + (f"; error: {s.get('error')}" if s.get("error") else ""))
        for log_line in (s.get("logs") or [])[-8:]:
            lines.append(f"    log: {log_line}")
    defs = {nid: {"label": n["data"].get("label"), "config": engine.config(n), "inputs": engine.upstream(graph, nid)} for nid, n in nodes.items()}
    datasets = _datasets(db, member)
    schema_text, _ = schema_context(db, member, datasets)
    system = ("You are Vyuham's AI Data Engineer debugging a failed pipeline run. Use only the listed tables and columns. "
              f"{ENGINE_NOTES}\n\nDataset tables:\n{schema_text}")
    prompt = (f"Run error: {redact_error_values(run.error or '')}\n\nSteps and logs:\n{redact_error_values(chr(10).join(lines))}\n\n"
              f"Step definitions (JSON):\n{redact_text(json.dumps(defs)[:12000])}\n\nFailed steps: {failed}\n"
              "Explain the failure and propose a fix for one step.")
    try:
        r = ask_json(db, member, "pipeline_debug", system, prompt, DEBUG_SCHEMA, effort="high", ref_kind="pipeline", ref_id=p.id)
    except AiUnavailable as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e)) from e
    except AiError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e
    fixed_graph, valid, check_problems = None, None, {}
    nid = r.data.get("node_id")
    if nid in nodes and (r.data.get("corrected_sql") or r.data.get("corrected_config")):
        fixed_graph = json.loads(json.dumps(p.graph))
        for n in fixed_graph["nodes"]:
            if n["id"] == nid:
                cfg = n.setdefault("data", {}).setdefault("config", {})
                if r.data.get("corrected_sql"):
                    cfg["sql"] = r.data["corrected_sql"]
                else:
                    try:
                        patch = json.loads(r.data["corrected_config"])
                        if isinstance(patch, dict):
                            cfg.update({k: v for k, v in patch.items() if k != "type"})
                    except json.JSONDecodeError:
                        pass
        check_problems = engine.dry_run(db, member, fixed_graph)
        valid = not check_problems and not engine.validate_graph(fixed_graph, datasets)
    result = {**r.data, "action_id": r.action.id, "graph": fixed_graph, "valid": valid, "check_problems": check_problems}
    update_output(db, r.action, {k: v for k, v in result.items() if k not in ("action_id", "graph")})
    return result
