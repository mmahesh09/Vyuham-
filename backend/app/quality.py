"""Data quality checks: rules on a dataset, run in DuckDB, with a sample of the rows that fail.

Rule kinds (params in brackets):
  not_null         the column has no blanks
  unique           no value appears twice (blanks ignored)
  accepted_values  every value is one of [values]
  range            numbers stay within [min] and/or [max]
  regex            every value matches [pattern]
  freshness        the newest date is at most [max_age_days] old
  row_count        the table has between [min] and [max] rows
  sql              a SELECT that returns the bad rows; passes when it returns none

A rule with severity "error" fails the run; "warn" only flags it.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal

import duckdb
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Dataset, QualityRule, QualityRun
from app.query import QueryError, _run, connect, quote, records, validate_select, view_name

Kind = Literal["not_null", "unique", "accepted_values", "range", "regex", "freshness", "row_count", "sql"]
KINDS: tuple[str, ...] = ("not_null", "unique", "accepted_values", "range", "regex", "freshness", "row_count", "sql")
NEEDS_COLUMN = {"not_null", "unique", "accepted_values", "range", "regex", "freshness"}
SAMPLE = 5
MAX_RULES = 50

LABEL = {
    "not_null": "No blanks",
    "unique": "Unique values",
    "accepted_values": "Allowed values",
    "range": "Within range",
    "regex": "Matches a pattern",
    "freshness": "Fresh data",
    "row_count": "Row count",
    "sql": "Custom SQL check",
}


class RuleIn(BaseModel):
    kind: Kind
    column: str | None = Field(default=None, max_length=255)
    params: dict[str, Any] = Field(default_factory=dict)
    severity: Literal["error", "warn"] = "error"
    enabled: bool = True

    @model_validator(mode="after")
    def _check(self) -> "RuleIn":
        p = self.params
        if self.kind in NEEDS_COLUMN and not self.column:
            raise ValueError("Pick a column for this check.")
        if self.kind == "accepted_values":
            vals = p.get("values")
            if not isinstance(vals, list) or not vals or len(vals) > 200 or not all(isinstance(v, (str, int, float)) for v in vals):
                raise ValueError("List the allowed values (up to 200).")
            self.params = {"values": [str(v) for v in vals]}
        elif self.kind in ("range", "row_count"):
            lo, hi = p.get("min"), p.get("max")
            for v in (lo, hi):
                if v is not None and not isinstance(v, (int, float)):
                    raise ValueError("Minimum and maximum must be numbers.")
            if lo is None and hi is None:
                raise ValueError("Set a minimum, a maximum or both.")
            if lo is not None and hi is not None and lo > hi:
                raise ValueError("The minimum is above the maximum.")
            self.params = {"min": lo, "max": hi}
        elif self.kind == "regex":
            pattern = p.get("pattern")
            if not isinstance(pattern, str) or not pattern or len(pattern) > 300:
                raise ValueError("Enter a pattern (up to 300 characters).")
            try:
                re.compile(pattern)
            except re.error as e:
                raise ValueError(f"That pattern isn't valid: {e}") from e
            self.params = {"pattern": pattern}
        elif self.kind == "freshness":
            days = p.get("max_age_days")
            if not isinstance(days, (int, float)) or not 0 < days <= 3650:
                raise ValueError("Set how many days old the newest row may be (1 to 3650).")
            self.params = {"max_age_days": days}
        elif self.kind == "sql":
            sql = p.get("sql")
            if not isinstance(sql, str) or not sql.strip() or len(sql) > 5000:
                raise ValueError("Write a SELECT that returns the rows that break the rule.")
            try:
                validate_select(sql)
            except QueryError as e:
                raise ValueError(str(e)) from e
            self.params = {"sql": sql.strip()}
        else:
            self.params = {}
        if self.kind not in NEEDS_COLUMN:
            self.column = None
        return self


def describe(rule: QualityRule | RuleIn) -> str:
    """The rule in plain words, for lists and notifications."""
    p, col = rule.params or {}, rule.column
    match rule.kind:
        case "not_null":
            return f"{col} is never blank"
        case "unique":
            return f"{col} has no duplicates"
        case "accepted_values":
            vals = p.get("values", [])
            shown = ", ".join(vals[:5]) + (f" and {len(vals) - 5} more" if len(vals) > 5 else "")
            return f"{col} is one of {shown}"
        case "range":
            lo, hi = p.get("min"), p.get("max")
            if lo is not None and hi is not None:
                return f"{col} is between {lo:g} and {hi:g}"
            return f"{col} is at least {lo:g}" if lo is not None else f"{col} is at most {hi:g}"
        case "regex":
            return f"{col} matches {p.get('pattern')}"
        case "freshness":
            return f"newest {col} is at most {p.get('max_age_days'):g} days old"
        case "row_count":
            lo, hi = p.get("min"), p.get("max")
            if lo is not None and hi is not None:
                return f"between {lo:,.0f} and {hi:,.0f} rows"
            return f"at least {lo:,.0f} rows" if lo is not None else f"at most {hi:,.0f} rows"
        case _:
            return "custom SQL returns no rows"


def check_columns(rule: RuleIn, ds: Dataset) -> None:
    if rule.column is None:
        return
    col = next((c for c in ds.columns if c["name"] == rule.column), None)
    if col is None:
        raise ValueError(f'"{rule.column}" isn\'t a column in {ds.name}.')
    if rule.kind == "range" and col.get("type") != "number":
        raise ValueError(f'"{rule.column}" isn\'t a number column.')
    if rule.kind == "freshness" and col.get("type") != "date":
        raise ValueError(f'"{rule.column}" isn\'t a date column.')


def _failing(rule: QualityRule, view: str) -> tuple[str, list[Any]] | None:
    """(WHERE clause for the bad rows, params), or None for table-level kinds."""
    c = quote(rule.column) if rule.column else ""
    p = rule.params or {}
    match rule.kind:
        case "not_null":
            return f"{c} IS NULL", []
        case "unique":
            return f"{c} IN (SELECT {c} FROM {view} WHERE {c} IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1)", []  # nosec B608
        case "accepted_values":
            vals = p.get("values", [])
            return f"{c} IS NOT NULL AND CAST({c} AS VARCHAR) NOT IN ({', '.join('?' for _ in vals)})", list(vals)
        case "range":
            parts, params = [], []
            if p.get("min") is not None:
                parts.append(f"{c} < ?")
                params.append(p["min"])
            if p.get("max") is not None:
                parts.append(f"{c} > ?")
                params.append(p["max"])
            return f"{c} IS NOT NULL AND ({' OR '.join(parts)})", params
        case "regex":
            return f"{c} IS NOT NULL AND NOT regexp_full_match(CAST({c} AS VARCHAR), ?)", [p.get("pattern", "")]
    return None


def _as_date(v: Any) -> date | None:
    if isinstance(v, datetime):
        return v.date()
    return v if isinstance(v, date) else None


def run_rule(con: duckdb.DuckDBPyConnection, rule: QualityRule, ds: Dataset, rows: int, today: date) -> dict:
    view = view_name(ds.id)
    out: dict[str, Any] = {
        "rule_id": rule.id, "kind": rule.kind, "column": rule.column, "severity": rule.severity,
        "description": describe(rule), "status": "pass", "failed": 0, "message": "", "sample": [],
    }
    try:
        if rule.kind == "row_count":
            lo, hi = rule.params.get("min"), rule.params.get("max")
            bad = (lo is not None and rows < lo) or (hi is not None and rows > hi)
            out.update(failed=1 if bad else 0, message=f"{rows:,} rows")
        elif rule.kind == "freshness":
            newest = _as_date(_run(con, f"SELECT MAX({quote(rule.column or '')}) FROM {view}", [], op="quality")[1][0][0])  # nosec B608
            age = (today - newest).days if newest else None
            bad = age is None or age > rule.params.get("max_age_days", 1)
            out.update(failed=1 if bad else 0, message=f"Newest is {newest.isoformat()} ({age} days old)" if newest else "No dates at all")
        elif rule.kind == "sql":
            sql = rule.params.get("sql", "")
            validate_select(sql)
            n = int(_run(con, f"SELECT COUNT(*) FROM ({sql}) AS q", [], op="quality")[1][0][0])  # validated SELECT  # nosec B608
            out["failed"] = n
            if n:
                out["sample"] = records(*_run(con, f"SELECT * FROM ({sql}) AS q LIMIT {SAMPLE}", [], op="quality"))  # nosec B608
        else:
            where, params = _failing(rule, view) or ("FALSE", [])
            n = int(_run(con, f"SELECT COUNT(*) FROM {view} WHERE {where}", list(params), op="quality")[1][0][0])  # nosec B608
            out["failed"] = n
            if n:
                out["sample"] = records(*_run(con, f"SELECT * FROM {view} WHERE {where} LIMIT {SAMPLE}", list(params), op="quality"))  # nosec B608
            out["message"] = f"{n:,} of {rows:,} rows break this rule" if n else "Every row passes"
        if out["failed"]:
            out["status"] = "fail"
    except (QueryError, duckdb.Error) as e:
        out.update(status="error", message=str(e).splitlines()[0][:200])
    return out


def run_checks(db: Session, ds: Dataset, trigger: str = "manual", now: datetime | None = None) -> QualityRun | None:
    """Run every enabled rule on the dataset and store the run. None when it has no rules."""
    rules = db.scalars(select(QualityRule).where(QualityRule.dataset_id == ds.id, QualityRule.enabled.is_(True))).all()
    if not rules:
        return None
    now = now or datetime.now(timezone.utc)
    con = connect(ds.workspace_id, _readable(db, ds, rules))
    try:
        rows = int(_run(con, f"SELECT COUNT(*) FROM {view_name(ds.id)}", [], op="quality")[1][0][0])  # nosec B608
        results = [run_rule(con, r, ds, rows, now.date()) for r in rules]
    except (QueryError, duckdb.Error) as e:
        run = QualityRun(workspace_id=ds.workspace_id, dataset_id=ds.id, trigger=trigger, status="error",
                         results=[{"status": "error", "message": str(e)[:200]}], row_count=None, created_at=now)
        db.add(run)
        db.commit()
        return run
    finally:
        con.close()
    failed = [r for r in results if r["status"] == "fail"]
    if any(r["severity"] == "error" for r in failed):
        status = "fail"
    elif failed or any(r["status"] == "error" for r in results):
        status = "warn"
    else:
        status = "pass"
    run = QualityRun(workspace_id=ds.workspace_id, dataset_id=ds.id, trigger=trigger, status=status, results=results, row_count=rows, created_at=now)
    db.add(run)
    if status == "fail" and trigger != "manual":
        from app.notify import deliver

        names = ", ".join(r["description"] for r in failed[:3])
        deliver(db, ds.workspace_id, {"inapp": True}, f"Quality check failed: {ds.name}", f"{len(failed)} check(s) failed: {names}.", f"/data/{ds.id}?tab=quality", "alert")
    db.commit()
    return run


def _readable(db: Session, ds: Dataset, rules: list[QualityRule]) -> list[Dataset]:
    """The dataset itself, plus every workspace dataset when a custom SQL rule may read other tables."""
    if any(r.kind == "sql" for r in rules):
        return list(db.scalars(select(Dataset).where(Dataset.workspace_id == ds.workspace_id)))
    return [ds]


def suggest(profile: dict, existing: list[QualityRule]) -> list[dict]:
    """Rules worth adding, read off the profile (skipping ones that already exist)."""
    have = {(r.kind, r.column) for r in existing}
    out: list[dict] = []
    rows = profile.get("rows", 0)

    def add(kind: str, column: str | None, params: dict, why: str) -> None:
        if (kind, column) not in have:
            out.append({"kind": kind, "column": column, "params": params, "severity": "error", "why": why})

    for c in profile.get("columns", []):
        name, kind = c["name"], c["type"]
        idish = bool(re.search(r"(^|_|\b)(id|code|key|number|no)$", name, re.I))
        if rows > 1 and c.get("unique") and c["empty"] == 0 and (idish or kind in ("text", "category")) and c["distinct"] == rows:
            add("unique", name, {}, f"Every {name} is different today; keep it that way.")
        if c["empty"] == 0 and rows:
            add("not_null", name, {}, f"{name} has no blanks today.")
        if kind == "category" and 1 < c.get("distinct", 0) <= 8 and c.get("top"):
            add("accepted_values", name, {"values": [t["value"] for t in c["top"]]}, f"{name} only uses {c['distinct']} values.")
        if kind == "number" and c.get("min") is not None and c["min"] >= 0:
            add("range", name, {"min": 0, "max": None}, f"{name} is never negative today.")
        if kind == "date" and c.get("max"):
            add("freshness", name, {"max_age_days": 7}, f"Catch it when {name} stops getting new rows.")
    if rows:
        add("row_count", None, {"min": max(1, int(rows * 0.5)), "max": None}, "Catch a load that brings in far fewer rows than usual.")
    return out[:12]


def due_for_check(last_run_at: datetime | None, now: datetime, every: timedelta = timedelta(days=1)) -> bool:
    if last_run_at is None:
        return True
    if last_run_at.tzinfo is None:
        last_run_at = last_run_at.replace(tzinfo=timezone.utc)
    return now - last_run_at >= every
