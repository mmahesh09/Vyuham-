"""Approved metrics and calculated columns: one definition, used by every part of Vyuham.

A metric belongs to one dataset. Each edit adds a version, and a version only reaches charts, alerts,
reports and Ask after it is approved and its effective date has arrived. Changing a formula can never
silently change numbers people already rely on.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any

import duckdb
from sqlalchemy import func, select
from sqlalchemy.orm import Session, object_session

from app.analytics.formula import Compiled, FormulaError, Scope, compile_formula
from app.models import CalculatedColumn, Dataset, MetricVersion, SemanticDimension, SemanticMetric
from app.query import QueryError, _bucket_label, _run, _where, quote, records, view_name


def _today() -> date:
    return datetime.now(timezone.utc).date()


def latest_version(db: Session, metric: SemanticMetric) -> MetricVersion | None:
    return db.scalar(select(MetricVersion).where(MetricVersion.metric_id == metric.id).order_by(MetricVersion.version.desc()).limit(1))


def approved_version(db: Session, metric: SemanticMetric, as_of: date | None = None) -> MetricVersion | None:
    """The approved version in force on `as_of`."""
    if metric.approved_version is None:
        return None
    return db.scalar(
        select(MetricVersion)
        .where(
            MetricVersion.metric_id == metric.id, MetricVersion.version <= metric.approved_version,
            MetricVersion.effective_from <= (as_of or _today()),
        )
        .order_by(MetricVersion.effective_from.desc(), MetricVersion.version.desc())
        .limit(1)
    )


def _find(db: Session, dataset: Dataset, name: str) -> SemanticMetric | None:
    return db.scalar(
        select(SemanticMetric).where(
            SemanticMetric.workspace_id == dataset.workspace_id, SemanticMetric.dataset_id == dataset.id,
            func.lower(SemanticMetric.name) == name.strip().lower(),
        )
    )


def scope_for(db: Session, dataset: Dataset, kind: str = "measure", approved_only: bool = False, as_of: date | None = None) -> Scope:
    def metric(name: str) -> tuple[str, str] | None:
        found = _find(db, dataset, name)
        if found is None:
            return None
        version = approved_version(db, found, as_of) if approved_only else latest_version(db, found)
        if version is None:
            raise FormulaError(f"“{found.name}” isn't approved and in effect yet.")
        return found.name, version.formula

    return Scope(columns=list(dataset.columns), kind=kind, metric=metric)  # type: ignore[arg-type]


def compile_measure(db: Session, dataset: Dataset, formula: str, own_name: str | None = None, approved_only: bool = False) -> Compiled:
    stack = (own_name.lower(),) if own_name else ()
    return compile_formula(formula, scope_for(db, dataset, "measure", approved_only), stack)


def require_approved(db: Session, dataset: Dataset, metric_id: str) -> SemanticMetric:
    metric = db.get(SemanticMetric, metric_id)
    # The same answer for missing and for another workspace's, so ids can't be probed.
    if metric is None or metric.workspace_id != dataset.workspace_id or metric.dataset_id != dataset.id:
        raise QueryError("That metric isn't available for this dataset.")
    if approved_version(db, metric) is None:
        raise QueryError(f"“{metric.name}” isn't approved and in effect yet.")
    return metric


def metric_sql(dataset: Dataset, metric_id: str) -> str:
    """The approved definition of a metric, as SQL over this dataset's view."""
    db = object_session(dataset)
    if db is None:
        raise QueryError("That metric isn't available here.")
    metric = require_approved(db, dataset, metric_id)
    version = approved_version(db, metric)
    try:
        return compile_measure(db, dataset, version.formula, metric.name, approved_only=True).sql
    except FormulaError as e:
        raise QueryError(f"“{metric.name}” no longer works: {e.message}") from e


# ---------- running formulas ----------


def _rows(con: duckdb.DuckDBPyConnection, sql: str, params: list[Any]) -> list[dict]:
    try:
        return records(*_run(con, sql, params, op="formula"))
    except duckdb.Error as e:
        raise QueryError("We couldn't calculate this formula with the current data.") from e


def preview_measure(con: duckdb.DuckDBPyConnection, dataset: Dataset, compiled: Compiled, group_by: str | None) -> list[dict]:
    view = view_name(dataset.id)
    if not group_by:
        return _rows(con, f"SELECT {compiled.sql} AS value FROM {view}", [])  # nosec B608 - compiled and quoted
    kind = next((c["type"] for c in dataset.columns if c["name"] == group_by), None)
    if kind is None:
        raise QueryError(f'The column "{group_by}" isn\'t in this dataset.')
    label = _bucket_label(group_by, "month") if kind == "date" else f"CAST({quote(group_by)} AS VARCHAR)"
    order = "label" if kind == "date" else "value DESC NULLS LAST"
    return _rows(con, f"SELECT {label} AS label, {compiled.sql} AS value FROM {view} GROUP BY 1 ORDER BY {order} LIMIT 20", [])  # nosec B608


def preview_column(con: duckdb.DuckDBPyConnection, dataset: Dataset, compiled: Compiled) -> list[dict]:
    shown = ", ".join(quote(c) for c in sorted(compiled.columns)[:4])
    return _rows(con, f"SELECT {compiled.sql} AS value{', ' + shown if shown else ''} FROM {view_name(dataset.id)} LIMIT 20", [])  # nosec B608


def measure_value(con: duckdb.DuckDBPyConnection, dataset: Dataset, compiled: Compiled, filters: list[dict]) -> float | None:
    params: list[Any] = []
    where = _where({c["name"]: c["type"] for c in dataset.columns}, filters, None, params)
    return _rows(con, f"SELECT {compiled.sql} AS value FROM {view_name(dataset.id)}{where}", params)[0]["value"]  # nosec B608


# ---------- calculated columns ----------


def refresh_calculated(db: Session, dataset: Dataset) -> None:
    """Rebuild a dataset's calculated columns. Call after anything that changes its columns.

    They live in `dataset.columns` with their compiled SQL, so charts, filters, SQL Lab and exports treat
    them like any other column. One that no longer compiles is left out and keeps its error for the UI.
    """
    columns = [c for c in dataset.columns if not c.get("calculated")]
    rows = db.scalars(
        select(CalculatedColumn).where(CalculatedColumn.dataset_id == dataset.id).order_by(CalculatedColumn.created_at, CalculatedColumn.id)
    ).all()
    for row in rows:
        try:
            if any(c["name"].lower() == row.name.lower() for c in columns):
                raise FormulaError(f"This dataset already has a column called “{row.name}”.")
            compiled = compile_formula(row.formula, Scope(columns=columns, kind="column"))
        except FormulaError as e:
            row.error = e.message[:500]
            continue
        row.error, row.type = None, compiled.type
        columns.append({
            "name": row.name, "type": compiled.type, "empty_ratio": 0.0, "examples": [], "calculated": True,
            "sql": compiled.sql, "window": compiled.level == "window",
        })
    dataset.columns = columns


# ---------- Ask ----------


@dataclass(frozen=True)
class AskTerm:
    dataset_id: str
    phrase: tuple[str, ...]
    kind: str  # metric | dimension
    target: str  # metric id, or the dimension's column
    label: str
    date_column: str | None = None


def ask_vocabulary(db: Session, workspace_id: str, split) -> list[AskTerm]:
    """The business words Ask should recognise. Only approved metrics in effect are included."""
    terms: list[AskTerm] = []
    for m in db.scalars(select(SemanticMetric).where(SemanticMetric.workspace_id == workspace_id, SemanticMetric.approved_version.is_not(None))):
        if approved_version(db, m) is None:
            continue
        for phrase in (m.name, *(m.synonyms or [])):
            if words := tuple(split(phrase)):
                terms.append(AskTerm(m.dataset_id, words, "metric", m.id, m.name, m.default_date_column))
    for d in db.scalars(select(SemanticDimension).where(SemanticDimension.workspace_id == workspace_id)):
        for phrase in (d.name, *(d.synonyms or [])):
            if words := tuple(split(phrase)):
                terms.append(AskTerm(d.dataset_id, words, "dimension", d.column, d.name))
    return sorted(terms, key=lambda t: -len(t.phrase))
