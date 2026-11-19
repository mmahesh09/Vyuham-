"""The semantic layer: formulas, metrics with versions and tests, dimensions, calculated columns, and audit trails.

Everyone in a workspace can read definitions. Owners and editors change them.
"""

from __future__ import annotations

import math
import time
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.analytics.formula import FUNCTIONS, Compiled, FormulaError, Scope, compile_formula
from app.analytics.semantic import (
    approved_version,
    compile_measure,
    latest_version,
    measure_value,
    preview_column,
    preview_measure,
    refresh_calculated,
)
from app.audit import log_query, record_action
from app.db import get_db
from app.models import (
    Alert,
    AuditLog,
    CalculatedColumn,
    Chart,
    Dashboard,
    Dataset,
    MetricTest,
    MetricVersion,
    QueryExecution,
    SemanticDimension,
    SemanticMetric,
    WorkspaceMember,
)
from app.query import QueryError, connect, quote
from app.routers.datasets import owned_dataset, require_editor
from app.schemas import SpecFilter, UtcDatetime
from app.security import current_membership

router = APIRouter(tags=["metrics"])
FormulaKind = Literal["measure", "column"]


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _short_list(values: list[str]) -> list[str]:
    return list(dict.fromkeys(v.strip() for v in values if v.strip()))


# ---------- formulas ----------


class FormulaIn(BaseModel):
    dataset_id: str = Field(max_length=32)
    formula: str = Field(max_length=2_000)
    kind: FormulaKind = "measure"
    metric_id: str | None = Field(default=None, max_length=32)  # the metric being edited, to catch self-reference
    column_id: str | None = Field(default=None, max_length=32)  # the calculated column being edited
    group_by: str | None = Field(default=None, max_length=255)


class FormulaProblem(BaseModel):
    message: str
    start: int
    end: int


class FormulaCheck(BaseModel):
    ok: bool
    type: str | None = None
    error: FormulaProblem | None = None
    columns: list[str] = Field(default_factory=list)
    metrics: list[str] = Field(default_factory=list)


class FormulaPreview(BaseModel):
    rows: list[dict]


def _compile(db: Session, member: WorkspaceMember, ds: Dataset, body: FormulaIn) -> Compiled:
    if body.kind == "column":
        hidden = None
        if body.column_id:
            row = db.get(CalculatedColumn, body.column_id)
            hidden = row.name if row and row.workspace_id == member.workspace_id else None
        return compile_formula(body.formula, Scope(columns=[c for c in ds.columns if c["name"] != hidden], kind="column"))
    own = None
    if body.metric_id:
        metric = db.get(SemanticMetric, body.metric_id)
        own = metric.name if metric and metric.workspace_id == member.workspace_id else None
    return compile_measure(db, ds, body.formula, own)


@router.get("/formulas/functions")
def formula_functions(member: WorkspaceMember = Depends(current_membership)):
    return FUNCTIONS


@router.post("/formulas/validate", response_model=FormulaCheck)
def validate_formula(body: FormulaIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    ds = owned_dataset(db, member, body.dataset_id)
    try:
        c = _compile(db, member, ds, body)
    except FormulaError as e:
        return FormulaCheck(ok=False, error=FormulaProblem(message=e.message, start=e.start, end=e.end))
    return FormulaCheck(ok=True, type=c.type, columns=sorted(c.columns), metrics=sorted(c.metrics))


@router.post("/formulas/preview", response_model=FormulaPreview)
def preview_formula(body: FormulaIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    ds = owned_dataset(db, member, body.dataset_id)
    started = time.perf_counter()
    try:
        compiled = _compile(db, member, ds, body)
    except FormulaError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, e.message) from e
    con = connect(member.workspace_id, [ds])
    try:
        rows = preview_column(con, ds, compiled) if body.kind == "column" else preview_measure(con, ds, compiled, body.group_by)
    except QueryError as e:
        log_query(db, member.workspace_id, member.user_id, "formula", started, "error")
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e
    finally:
        con.close()
    log_query(db, member.workspace_id, member.user_id, "formula", started, rows=len(rows))
    return FormulaPreview(rows=rows)


# ---------- metrics ----------


class MetricFields(BaseModel):
    description: str | None = Field(default=None, max_length=1_000)
    format: Literal["number", "currency", "percent"] = "number"
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    unit: str | None = Field(default=None, max_length=24)
    default_date_column: str | None = Field(default=None, max_length=255)
    synonyms: list[str] = Field(default_factory=list, max_length=20)
    owner_id: str | None = Field(default=None, max_length=64)

    @field_validator("synonyms")
    @classmethod
    def _synonyms(cls, v: list[str]) -> list[str]:
        if any(len(s) > 80 for s in v):
            raise ValueError("Keep each alternative name under 80 characters")
        return _short_list(v)


class MetricIn(MetricFields):
    name: str = Field(min_length=1, max_length=120)
    dataset_id: str = Field(max_length=32)
    formula: str = Field(min_length=1, max_length=2_000)
    effective_from: date | None = None


class MetricPatch(MetricFields):
    name: str = Field(min_length=1, max_length=120)


class VersionIn(BaseModel):
    formula: str = Field(min_length=1, max_length=2_000)
    effective_from: date | None = None
    note: str | None = Field(default=None, max_length=300)


class VersionOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    version: int
    formula: str
    effective_from: date
    note: str | None
    created_by: str | None
    created_at: UtcDatetime


class MetricOut(BaseModel):
    id: str
    name: str
    dataset_id: str
    description: str | None
    format: str
    currency: str | None
    unit: str | None
    default_date_column: str | None
    synonyms: list[str]
    owner_id: str | None
    formula: str  # the newest version
    version: int
    approved_version: int | None
    approved_formula: str | None  # what charts use today
    created_at: UtcDatetime
    updated_at: UtcDatetime


def _metric_out(db: Session, m: SemanticMetric) -> MetricOut:
    latest, live = latest_version(db, m), approved_version(db, m)
    return MetricOut(
        id=m.id, name=m.name, dataset_id=m.dataset_id, description=m.description, format=m.format, currency=m.currency,
        unit=m.unit, default_date_column=m.default_date_column, synonyms=m.synonyms or [], owner_id=m.owner_id,
        formula=latest.formula, version=latest.version, approved_version=m.approved_version,
        approved_formula=live.formula if live else None, created_at=m.created_at, updated_at=m.updated_at,
    )


def _metric(db: Session, member: WorkspaceMember, metric_id: str) -> SemanticMetric:
    m = db.get(SemanticMetric, metric_id)
    if m is None or m.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Metric not found")
    return m


def _dataset_of(db: Session, m: SemanticMetric) -> Dataset:
    ds = db.get(Dataset, m.dataset_id)
    if ds is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "The dataset behind this metric was deleted.")
    return ds


def _check_fields(db: Session, member: WorkspaceMember, ds: Dataset, body: MetricFields) -> None:
    if body.default_date_column and not any(c["name"] == body.default_date_column and c["type"] == "date" for c in ds.columns):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f'"{body.default_date_column}" isn\'t a date column in {ds.name}.')
    if body.format == "currency" and not body.currency:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Pick a currency, such as INR or USD.")
    if body.owner_id:
        found = db.scalar(select(WorkspaceMember.user_id).where(WorkspaceMember.user_id == body.owner_id, WorkspaceMember.workspace_id == member.workspace_id))
        if found is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "The metric owner must be in this workspace.")


def _valid(db: Session, ds: Dataset, formula: str, name: str) -> None:
    try:
        compile_measure(db, ds, formula, name)
    except FormulaError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, e.message) from e


def _name_free(db: Session, workspace_id: str, name: str, skip: str | None = None) -> None:
    taken = db.scalar(select(SemanticMetric.id).where(SemanticMetric.workspace_id == workspace_id, func.lower(SemanticMetric.name) == name.lower()))
    if taken and taken != skip:
        raise HTTPException(status.HTTP_409_CONFLICT, "A metric with this name already exists.")


@router.get("/metrics", response_model=list[MetricOut])
def list_metrics(dataset_id: str | None = Query(None, max_length=32), member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    q = select(SemanticMetric).where(SemanticMetric.workspace_id == member.workspace_id)
    if dataset_id:
        q = q.where(SemanticMetric.dataset_id == dataset_id)
    return [_metric_out(db, m) for m in db.scalars(q.order_by(SemanticMetric.name))]


@router.post("/metrics", response_model=MetricOut, status_code=status.HTTP_201_CREATED)
def create_metric(body: MetricIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    ds = owned_dataset(db, member, body.dataset_id)
    name = body.name.strip()
    _name_free(db, member.workspace_id, name)
    _check_fields(db, member, ds, body)
    _valid(db, ds, body.formula, name)
    m = SemanticMetric(
        workspace_id=member.workspace_id, dataset_id=ds.id, name=name, description=body.description, format=body.format,
        currency=body.currency, unit=body.unit, default_date_column=body.default_date_column, synonyms=body.synonyms,
        owner_id=body.owner_id or member.user_id, created_by=member.user_id,
    )
    db.add(m)
    db.flush()
    db.add(MetricVersion(metric_id=m.id, workspace_id=member.workspace_id, version=1, formula=body.formula.strip(),
                         effective_from=body.effective_from or _today(), created_by=member.user_id))
    record_action(db, member, "metric.create", "metric", m.id, {"version": 1})
    db.commit()
    return _metric_out(db, m)


@router.get("/metrics/{metric_id}", response_model=MetricOut)
def get_metric(metric_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return _metric_out(db, _metric(db, member, metric_id))


@router.put("/metrics/{metric_id}", response_model=MetricOut)
def update_metric(metric_id: str, body: MetricPatch, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Name, description and display details. The formula only changes through a new version."""
    require_editor(member)
    m = _metric(db, member, metric_id)
    name = body.name.strip()
    _name_free(db, member.workspace_id, name, skip=m.id)
    _check_fields(db, member, _dataset_of(db, m), body)
    if name.lower() != m.name.lower() and _used_by(db, m)["metrics"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "Other metrics refer to this one by name. Update them first.")
    m.name, m.description, m.format, m.currency, m.unit = name, body.description, body.format, body.currency, body.unit
    m.default_date_column, m.synonyms = body.default_date_column, body.synonyms
    m.owner_id = body.owner_id or m.owner_id
    record_action(db, member, "metric.update", "metric", m.id)
    db.commit()
    return _metric_out(db, m)


@router.get("/metrics/{metric_id}/versions", response_model=list[VersionOut])
def list_versions(metric_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    m = _metric(db, member, metric_id)
    return db.scalars(select(MetricVersion).where(MetricVersion.metric_id == m.id).order_by(MetricVersion.version.desc())).all()


@router.post("/metrics/{metric_id}/versions", response_model=MetricOut, status_code=status.HTTP_201_CREATED)
def add_version(metric_id: str, body: VersionIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Charts keep using the approved version until this one is approved."""
    require_editor(member)
    m = _metric(db, member, metric_id)
    _valid(db, _dataset_of(db, m), body.formula, m.name)
    latest = latest_version(db, m)
    number = latest.version + 1
    db.add(MetricVersion(metric_id=m.id, workspace_id=member.workspace_id, version=number, formula=body.formula.strip(),
                         effective_from=body.effective_from or _today(), note=body.note, created_by=member.user_id))
    m.updated_at = datetime.now(timezone.utc)
    record_action(db, member, "metric.version", "metric", m.id, {"version": number})
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Someone else just changed this metric. Try again.") from e
    return _metric_out(db, m)


@router.post("/metrics/{metric_id}/approve", response_model=MetricOut)
def approve_metric(metric_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Make the newest version the official one. Everything it builds on must be approved, and its tests must pass."""
    require_editor(member)
    m = _metric(db, member, metric_id)
    ds = _dataset_of(db, m)
    latest = latest_version(db, m)
    try:
        compile_measure(db, ds, latest.formula, m.name, approved_only=True)
    except FormulaError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, e.message) from e
    failed = [r.name for r in _run_tests(db, member, m, ds) if r.status != "passed"]
    if failed:
        raise HTTPException(status.HTTP_409_CONFLICT, f"This test doesn't pass yet: {failed[0]}.")
    m.approved_version = latest.version
    record_action(db, member, "metric.approve", "metric", m.id, {"version": latest.version})
    db.commit()
    return _metric_out(db, m)


def _used_by(db: Session, m: SemanticMetric) -> dict[str, list[str]]:
    charts = db.scalars(select(Chart).join(Dashboard).where(Dashboard.workspace_id == m.workspace_id, Chart.dataset_id == m.dataset_id)).all()
    alerts = db.scalars(select(Alert).where(Alert.workspace_id == m.workspace_id, Alert.dataset_id == m.dataset_id)).all()
    ds = db.get(Dataset, m.dataset_id)
    metrics: list[str] = []
    if ds is not None:
        others = db.scalars(select(SemanticMetric).where(SemanticMetric.dataset_id == m.dataset_id, SemanticMetric.id != m.id)).all()
        for other in others:
            try:
                if m.name in compile_measure(db, ds, latest_version(db, other).formula, other.name).metrics:
                    metrics.append(other.name)
            except FormulaError:
                continue
    return {
        "charts": [c.spec.get("title", "Chart") for c in charts if any(x.get("agg") == "metric" and x.get("field") == m.id for x in c.spec.get("metrics") or [])],
        "alerts": [a.name for a in alerts if (a.metric or {}).get("agg") == "metric" and a.metric.get("field") == m.id],
        "metrics": metrics,
    }


@router.delete("/metrics/{metric_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_metric(metric_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    m = _metric(db, member, metric_id)
    used = _used_by(db, m)
    for kind, names in used.items():
        if names:
            raise HTTPException(status.HTTP_409_CONFLICT, f"“{names[0]}” uses this metric. Remove it from {kind} first.")
    for model in (MetricTest, MetricVersion):
        for row in db.scalars(select(model).where(model.metric_id == m.id)):
            db.delete(row)
    record_action(db, member, "metric.delete", "metric", m.id)
    db.delete(m)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- metric tests ----------


class MetricTestIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    filters: list[SpecFilter] = Field(default_factory=list, max_length=10)
    expected: float | None = None  # None: the metric should come out empty
    tolerance: float = Field(default=0, ge=0)


class MetricTestOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    name: str
    filters: list
    expected: float | None
    tolerance: float


class MetricTestResult(BaseModel):
    id: str
    name: str
    status: Literal["passed", "failed", "error"]
    expected: float | None
    actual: float | None
    message: str | None = None


def _run_tests(db: Session, member: WorkspaceMember, m: SemanticMetric, ds: Dataset) -> list[MetricTestResult]:
    tests = db.scalars(select(MetricTest).where(MetricTest.metric_id == m.id).order_by(MetricTest.created_at)).all()
    if not tests:
        return []
    out: list[MetricTestResult] = []
    con = connect(member.workspace_id, [ds])
    try:
        compiled = compile_measure(db, ds, latest_version(db, m).formula, m.name)
        for t in tests:
            try:
                raw = measure_value(con, ds, compiled, t.filters or [])
                actual = float(raw) if raw is not None else None
            except (QueryError, TypeError, ValueError) as e:
                out.append(MetricTestResult(id=t.id, name=t.name, status="error", expected=t.expected, actual=None, message=str(e)[:200]))
                continue
            same = actual is None if t.expected is None else actual is not None and math.isclose(actual, t.expected, abs_tol=max(t.tolerance, 1e-9))
            out.append(MetricTestResult(id=t.id, name=t.name, status="passed" if same else "failed", expected=t.expected, actual=actual))
    except FormulaError as e:
        return [MetricTestResult(id=t.id, name=t.name, status="error", expected=t.expected, actual=None, message=e.message) for t in tests]
    finally:
        con.close()
    return out


@router.get("/metrics/{metric_id}/tests", response_model=list[MetricTestOut])
def list_tests(metric_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    m = _metric(db, member, metric_id)
    return db.scalars(select(MetricTest).where(MetricTest.metric_id == m.id).order_by(MetricTest.created_at)).all()


@router.post("/metrics/{metric_id}/tests", response_model=MetricTestOut, status_code=status.HTTP_201_CREATED)
def add_test(metric_id: str, body: MetricTestIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    m = _metric(db, member, metric_id)
    t = MetricTest(metric_id=m.id, workspace_id=member.workspace_id, name=body.name.strip(), filters=[f.model_dump() for f in body.filters],
                   expected=body.expected, tolerance=body.tolerance)
    db.add(t)
    db.commit()
    return t


@router.delete("/metrics/{metric_id}/tests/{test_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_test(metric_id: str, test_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    m = _metric(db, member, metric_id)
    t = db.get(MetricTest, test_id)
    if t is None or t.metric_id != m.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Test not found")
    db.delete(t)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/metrics/{metric_id}/tests/run", response_model=list[MetricTestResult])
def run_tests(metric_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    m = _metric(db, member, metric_id)
    return _run_tests(db, member, m, _dataset_of(db, m))


@router.get("/metrics/{metric_id}/sql")
def metric_as_sql(metric_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """The approved definition as a query, for SQL Lab (owners and editors, like SQL Lab itself)."""
    from app.query import table_names

    require_editor(member)
    m = _metric(db, member, metric_id)
    ds = _dataset_of(db, m)
    version = approved_version(db, m)
    if version is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Approve this metric before using it in SQL Lab.")
    try:
        compiled = compile_measure(db, ds, version.formula, m.name, approved_only=True)
    except FormulaError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, e.message) from e
    datasets = list(db.scalars(select(Dataset).where(Dataset.workspace_id == member.workspace_id)))
    return {"sql": f"SELECT {compiled.sql} AS {quote(m.name)}\nFROM {quote(table_names(datasets)[ds.id])}"}  # nosec B608 - compiled and quoted


# ---------- dimensions ----------


class DimensionIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    dataset_id: str = Field(max_length=32)
    column: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1_000)
    synonyms: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("synonyms")
    @classmethod
    def _synonyms(cls, v: list[str]) -> list[str]:
        return _short_list([s[:80] for s in v])


class DimensionOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    name: str
    dataset_id: str
    column: str
    description: str | None
    synonyms: list[str]


@router.get("/dimensions", response_model=list[DimensionOut])
def list_dimensions(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return db.scalars(select(SemanticDimension).where(SemanticDimension.workspace_id == member.workspace_id).order_by(SemanticDimension.name)).all()


@router.post("/dimensions", response_model=DimensionOut, status_code=status.HTTP_201_CREATED)
def create_dimension(body: DimensionIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    ds = owned_dataset(db, member, body.dataset_id)
    if not any(c["name"] == body.column for c in ds.columns):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f'"{body.column}" isn\'t a column in {ds.name}.')
    d = SemanticDimension(workspace_id=member.workspace_id, dataset_id=ds.id, name=body.name.strip(), column=body.column,
                          description=body.description, synonyms=body.synonyms, created_by=member.user_id)
    db.add(d)
    record_action(db, member, "dimension.create", "dimension", None, {"name": d.name})
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "A dimension with this name already exists.") from e
    return d


@router.delete("/dimensions/{dimension_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dimension(dimension_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    d = db.get(SemanticDimension, dimension_id)
    if d is None or d.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dimension not found")
    record_action(db, member, "dimension.delete", "dimension", d.id)
    db.delete(d)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- calculated columns ----------


class CalculatedIn(BaseModel):
    dataset_id: str = Field(max_length=32)
    name: str = Field(min_length=1, max_length=120)
    formula: str = Field(min_length=1, max_length=2_000)


class CalculatedOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    dataset_id: str
    name: str
    formula: str
    type: str | None
    error: str | None


def _calculated(db: Session, member: WorkspaceMember, column_id: str) -> CalculatedColumn:
    row = db.get(CalculatedColumn, column_id)
    if row is None or row.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Column not found")
    return row


def _save_calculated(db: Session, member: WorkspaceMember, ds: Dataset, row: CalculatedColumn, name: str, formula: str) -> CalculatedColumn:
    others = [c for c in ds.columns if c["name"] != row.name or not c.get("calculated")]
    if any(c["name"].lower() == name.lower() for c in others):
        raise HTTPException(status.HTTP_409_CONFLICT, f"This dataset already has a column called “{name}”.")
    try:
        compile_formula(formula, Scope(columns=others, kind="column"))
    except FormulaError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, e.message) from e
    row.name, row.formula = name, formula
    db.add(row)
    db.flush()
    refresh_calculated(db, ds)
    record_action(db, member, "calculated_column.save", "dataset", ds.id, {"column": name})
    db.commit()
    return row


@router.get("/calculated-columns", response_model=list[CalculatedOut])
def list_calculated(dataset_id: str | None = Query(None, max_length=32), member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    q = select(CalculatedColumn).where(CalculatedColumn.workspace_id == member.workspace_id)
    if dataset_id:
        q = q.where(CalculatedColumn.dataset_id == dataset_id)
    return db.scalars(q.order_by(CalculatedColumn.created_at)).all()


@router.post("/calculated-columns", response_model=CalculatedOut, status_code=status.HTTP_201_CREATED)
def create_calculated(body: CalculatedIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    ds = owned_dataset(db, member, body.dataset_id)
    row = CalculatedColumn(workspace_id=member.workspace_id, dataset_id=ds.id, name="", formula="", created_by=member.user_id)
    return _save_calculated(db, member, ds, row, body.name.strip(), body.formula.strip())


@router.put("/calculated-columns/{column_id}", response_model=CalculatedOut)
def update_calculated(column_id: str, body: CalculatedIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    row = _calculated(db, member, column_id)
    ds = owned_dataset(db, member, row.dataset_id)
    return _save_calculated(db, member, ds, row, body.name.strip(), body.formula.strip())


@router.delete("/calculated-columns/{column_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_calculated(column_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    row = _calculated(db, member, column_id)
    ds = owned_dataset(db, member, row.dataset_id)
    db.delete(row)
    db.flush()
    refresh_calculated(db, ds)
    record_action(db, member, "calculated_column.delete", "dataset", ds.id, {"column": row.name})
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- audit trails (owners) ----------


class AuditOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    user_id: str | None
    action: str
    target_type: str
    target_id: str | None
    detail: dict
    created_at: UtcDatetime


class QueryExecutionOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    user_id: str | None
    kind: str
    status: str
    rows: int | None
    duration_ms: int
    created_at: UtcDatetime


def _owner(member: WorkspaceMember) -> None:
    if member.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only workspace owners can see this.")


@router.get("/audit-logs", response_model=list[AuditOut])
def audit_logs(limit: int = Query(100, ge=1, le=500), member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _owner(member)
    return db.scalars(select(AuditLog).where(AuditLog.workspace_id == member.workspace_id).order_by(AuditLog.created_at.desc()).limit(limit)).all()


@router.get("/query-executions", response_model=list[QueryExecutionOut])
def query_executions(limit: int = Query(100, ge=1, le=500), member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _owner(member)
    return db.scalars(select(QueryExecution).where(QueryExecution.workspace_id == member.workspace_id).order_by(QueryExecution.created_at.desc()).limit(limit)).all()
