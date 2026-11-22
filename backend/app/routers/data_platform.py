"""Data platform endpoints: profiling, quality checks, lineage, query-built and linked datasets."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import record_action
from app.config import get_settings
from app.db import get_db
from app.ingest import IngestError, ingest, write_parquet
from app.materialize import MaterializeError, build, lineage_for
from app.models import Dataset, QualityRule, QualityRun, WorkspaceMember
from app.profile import profile_dataset
from app.quality import MAX_RULES, RuleIn, check_columns, describe, run_checks, suggest
from app.query import QueryError, connect
from app.routers.datasets import _unique_name, check_quota, owned_dataset, parquet_path, queue_sync, require_editor
from app.schemas import DatasetOut, SqlParam, UtcDatetime
from app.security import current_membership
from app.url_ingest import UrlError, fetch

router = APIRouter(tags=["data-platform"])

Layer = Literal["bronze", "silver", "gold"]


def _unprocessable(message: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, message)


# ---------- profile + lineage ----------


@router.get("/datasets/{dataset_id}/profile")
def dataset_profile(dataset_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    ds = owned_dataset(db, member, dataset_id)
    con = connect(member.workspace_id, [ds])
    try:
        return profile_dataset(con, ds)
    except QueryError as e:
        raise _unprocessable(str(e)) from e
    finally:
        con.close()


@router.get("/datasets/{dataset_id}/lineage")
def dataset_lineage(dataset_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return lineage_for(db, owned_dataset(db, member, dataset_id))


# ---------- quality ----------


class RuleOut(BaseModel):
    id: str
    kind: str
    column: str | None
    params: dict
    severity: str
    enabled: bool
    description: str
    created_at: UtcDatetime


class RunOut(BaseModel):
    id: str
    trigger: str
    status: str
    results: list
    row_count: int | None
    created_at: UtcDatetime


class RulePatch(BaseModel):
    severity: Literal["error", "warn"] | None = None
    enabled: bool | None = None


def _rule_out(r: QualityRule) -> RuleOut:
    return RuleOut(id=r.id, kind=r.kind, column=r.column, params=r.params or {}, severity=r.severity, enabled=r.enabled, description=describe(r), created_at=r.created_at)


def _rule(db: Session, ds: Dataset, rule_id: str) -> QualityRule:
    r = db.get(QualityRule, rule_id)
    if r is None or r.dataset_id != ds.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check not found")
    return r


@router.get("/datasets/{dataset_id}/quality", response_model=dict)
def quality_overview(dataset_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Rules, the last 20 runs, and suggestions read off the profile."""
    ds = owned_dataset(db, member, dataset_id)
    rules = db.scalars(select(QualityRule).where(QualityRule.dataset_id == ds.id).order_by(QualityRule.created_at)).all()
    runs = db.scalars(select(QualityRun).where(QualityRun.dataset_id == ds.id).order_by(QualityRun.created_at.desc()).limit(20)).all()
    suggestions: list[dict] = []
    con = connect(member.workspace_id, [ds])
    try:
        suggestions = suggest(profile_dataset(con, ds), list(rules))
    except QueryError:
        suggestions = []
    finally:
        con.close()
    return {
        "rules": [_rule_out(r).model_dump(mode="json") for r in rules],
        "runs": [RunOut.model_validate(r, from_attributes=True).model_dump(mode="json") for r in runs],
        "suggestions": [{**s, "description": describe(RuleIn.model_construct(**{k: s[k] for k in ("kind", "column", "params")}))} for s in suggestions],
    }


@router.post("/datasets/{dataset_id}/quality/rules", response_model=RuleOut, status_code=status.HTTP_201_CREATED)
def add_rule(dataset_id: str, body: dict, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    ds = owned_dataset(db, member, dataset_id)
    try:
        rule = RuleIn.model_validate(body)
        check_columns(rule, ds)
    except ValidationError as e:
        raise _unprocessable(str(e.errors()[0].get("msg", "That check isn't valid.")).removeprefix("Value error, ")) from e
    except ValueError as e:
        raise _unprocessable(str(e)) from e
    count = len(db.scalars(select(QualityRule.id).where(QualityRule.dataset_id == ds.id)).all())
    if count >= MAX_RULES:
        raise _unprocessable(f"A dataset can have up to {MAX_RULES} checks.")
    r = QualityRule(workspace_id=ds.workspace_id, dataset_id=ds.id, kind=rule.kind, column=rule.column, params=rule.params,
                    severity=rule.severity, enabled=rule.enabled, created_by=member.user_id)
    db.add(r)
    record_action(db, member, "quality_rule.create", "dataset", ds.id, {"kind": rule.kind, "column": rule.column})
    db.commit()
    db.refresh(r)
    return _rule_out(r)


@router.patch("/datasets/{dataset_id}/quality/rules/{rule_id}", response_model=RuleOut)
def update_rule(dataset_id: str, rule_id: str, body: RulePatch, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    r = _rule(db, owned_dataset(db, member, dataset_id), rule_id)
    if body.severity is not None:
        r.severity = body.severity
    if body.enabled is not None:
        r.enabled = body.enabled
    db.commit()
    return _rule_out(r)


@router.delete("/datasets/{dataset_id}/quality/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(dataset_id: str, rule_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    ds = owned_dataset(db, member, dataset_id)
    r = _rule(db, ds, rule_id)
    record_action(db, member, "quality_rule.delete", "dataset", ds.id, {"kind": r.kind, "column": r.column})
    db.delete(r)
    db.commit()


@router.post("/datasets/{dataset_id}/quality/run", response_model=RunOut)
def run_quality(dataset_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    ds = owned_dataset(db, member, dataset_id)
    run = run_checks(db, ds, "manual")
    if run is None:
        raise _unprocessable("Add a check first.")
    return RunOut.model_validate(run, from_attributes=True)


# ---------- datasets built from a query ----------


class DerivedIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    sql: str = Field(min_length=1, max_length=10_000)
    params: list[SqlParam] = Field(default_factory=list, max_length=20)
    layer: Layer | None = None
    description: str | None = Field(default=None, max_length=500)
    refresh: Literal["manual", "hourly", "daily"] = "manual"


@router.post("/datasets/derived", response_model=DatasetOut, status_code=status.HTTP_201_CREATED)
def create_derived(body: DerivedIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Save a query's result as a dataset (SQL Lab "Save as dataset")."""
    require_editor(member)
    check_quota(db, member.workspace_id, new_datasets=1)
    ds = Dataset(
        workspace_id=member.workspace_id, created_by=member.user_id, name=_unique_name(db, member.workspace_id, body.name.strip()),
        source_filename="SQL query", source_kind="derived", row_count=0, columns=[], file_size=0,
        layer=body.layer, description=body.description, refresh=body.refresh,
    )
    db.add(ds)
    db.flush()
    try:
        build(db, ds, body.sql, [p.model_dump() for p in body.params])
    except (MaterializeError, QueryError) as e:
        db.rollback()
        parquet_path(member.workspace_id, ds.id).unlink(missing_ok=True)
        raise _unprocessable(str(e)) from e
    record_action(db, member, "dataset.derive", "dataset", ds.id, {"layer": body.layer})
    db.commit()
    db.refresh(ds)
    return ds


@router.post("/datasets/{dataset_id}/rebuild", response_model=DatasetOut, status_code=status.HTTP_202_ACCEPTED)
def rebuild_now(dataset_id: str, background: BackgroundTasks, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Re-run a query-built dataset (or re-download a linked one) in the background."""
    require_editor(member)
    ds = owned_dataset(db, member, dataset_id)
    if (ds.origin or {}).get("kind") not in ("sql", "url"):
        raise _unprocessable("Only datasets built from a query or a link can be rebuilt.")
    queue_sync(db, ds, background)
    return ds


# ---------- datasets from a link ----------


class UrlIn(BaseModel):
    url: str = Field(min_length=8, max_length=2000)
    name: str | None = Field(default=None, max_length=200)
    layer: Layer | None = None
    refresh: Literal["manual", "hourly", "daily"] = "manual"


def download_into(db: Session, ds: Dataset, url: str) -> Dataset:
    """Fetch a link and write it as the dataset's data (first import and every refresh)."""
    s = get_settings()
    try:
        raw, filename, _ = fetch(url)
        result = ingest(raw, filename, max_rows=s.max_upload_rows)
    except (UrlError, IngestError) as e:
        raise MaterializeError(str(e)) from e
    ds.file_size = write_parquet(result.frame, parquet_path(ds.workspace_id, ds.id))
    ds.columns = [c.as_dict() for c in result.columns]
    ds.row_count = len(result.frame)
    ds.source_filename = filename[:255]
    ds.sheet = result.sheet
    return ds


@router.post("/datasets/url", response_model=DatasetOut, status_code=status.HTTP_201_CREATED)
def import_url(body: UrlIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    check_quota(db, member.workspace_id, new_datasets=1, new_bytes=get_settings().max_upload_bytes // 4)
    ds = Dataset(
        workspace_id=member.workspace_id, created_by=member.user_id, name="import", source_filename="link",
        source_kind="url", row_count=0, columns=[], file_size=0, layer=body.layer, refresh=body.refresh,
        origin={"kind": "url", "url": body.url.strip()},
    )
    db.add(ds)
    db.flush()
    try:
        download_into(db, ds, body.url)
    except MaterializeError as e:
        db.rollback()
        parquet_path(member.workspace_id, ds.id).unlink(missing_ok=True)
        raise _unprocessable(str(e)) from e
    ds.name = _unique_name(db, member.workspace_id, (body.name or Path(ds.source_filename).stem or "Imported data").strip()[:190])
    ds.last_synced_at = ds.sync_started_at = ds.sync_finished_at = datetime.now(timezone.utc)
    record_action(db, member, "dataset.import_url", "dataset", ds.id, None)
    db.commit()
    db.refresh(ds)
    return ds

