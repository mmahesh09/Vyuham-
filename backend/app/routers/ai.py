"""AI help in the SQL Workbench: write, explain, fix, optimize, convert to Python. Plus the AI action log.

Generated SQL is never run here. It is checked against the real workspace (parsed as one read-only
SELECT, then planned by DuckDB against the person's own views, which proves every table and column
exists); one repair round is attempted when the check fails, and the result says whether it passed.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import ENGINE_NOTES, AiError, AiUnavailable, ai_enabled, ask_json, schema_context, update_output
from app.db import get_db
from app.governance import connect_as, redact_text
from app.models import AiAction, WorkspaceMember
from app.query import QueryError, explain_sql
from app.routers.sql_lab import _datasets, _editor
from app.schemas import SqlParam, UtcDatetime
from app.security import current_membership
from app.sql_params import bind

router = APIRouter(prefix="/ai", tags=["ai"])

Action = Literal["write", "explain", "fix", "optimize", "python"]


class SqlAiIn(BaseModel):
    action: Action
    question: str | None = Field(default=None, max_length=2000)
    sql: str | None = Field(default=None, max_length=10_000)
    error: str | None = Field(default=None, max_length=2000)
    params: list[SqlParam] = Field(default_factory=list, max_length=20)


class SqlAiOut(BaseModel):
    action_id: str
    sql: str | None = None
    python: str | None = None
    explanation: str
    changes: list[str] = []
    valid: bool | None = None  # SQL checked against the workspace (None when there is no SQL)
    check_error: str | None = None


def unavailable(e: Exception) -> HTTPException:
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e))


SQL_SCHEMA = {
    "type": "object",
    "properties": {
        "sql": {"type": "string", "description": "The SQL, or an empty string when it can't be written from the listed tables."},
        "explanation": {"type": "string"},
        "changes": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["sql", "explanation", "changes"],
    "additionalProperties": False,
}
EXPLAIN_SCHEMA = {
    "type": "object",
    "properties": {"explanation": {"type": "string"}, "steps": {"type": "array", "items": {"type": "string"}}},
    "required": ["explanation", "steps"],
    "additionalProperties": False,
}
PYTHON_SCHEMA = {
    "type": "object",
    "properties": {"python": {"type": "string"}, "explanation": {"type": "string"}},
    "required": ["python", "explanation"],
    "additionalProperties": False,
}


def check_sql(db: Session, member: WorkspaceMember, sql: str, params: list[SqlParam]) -> str | None:
    """None when the SQL is one read-only SELECT that DuckDB can plan against this member's tables."""
    if not sql.strip():
        return "No SQL was produced."
    con = connect_as(db, member, _datasets(db, member))
    try:
        from app.sql_params import param_names

        names = set(param_names(sql))
        filled = [p for p in params if p.name in names]
        missing = names - {p.name for p in filled}
        filled += [SqlParam(name=n, type="text", value="") for n in missing]
        explain_sql(con, *bind(sql, filled))
        return None
    except QueryError as e:
        return str(e)
    finally:
        con.close()


@router.get("/status")
def ai_status(member: WorkspaceMember = Depends(current_membership)):
    return {"enabled": ai_enabled()}


@router.post("/sql", response_model=SqlAiOut)
def sql_ai(body: SqlAiIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    schema_text, _ = schema_context(db, member, _datasets(db, member))
    system = (
        "You are a senior analytics engineer helping in Vyuham's SQL Workbench. "
        f"{ENGINE_NOTES}\n\nTables available to this person:\n{schema_text}"
    )
    sql = body.sql or ""
    if body.action in ("explain", "fix", "optimize", "python") and not sql.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Write or open a query first.")
    if body.action == "write" and not (body.question or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Ask a question first.")
    question = redact_text(body.question or "")
    error = redact_text(body.error or "")

    try:
        if body.action == "explain":
            r = ask_json(db, member, "sql_explain", system,
                         f"Explain what this query does, for someone who knows the business but not SQL. Be concise.\n\n```sql\n{sql}\n```",
                         EXPLAIN_SCHEMA, effort="low")
            text = r.data["explanation"] + ("\n\n" + "\n".join(f"{i + 1}. {s}" for i, s in enumerate(r.data["steps"])) if r.data["steps"] else "")
            return SqlAiOut(action_id=r.action.id, explanation=text)
        if body.action == "python":
            r = ask_json(db, member, "sql_python", system,
                         "Convert this query to Python with pandas. Assume each table is already a pandas DataFrame with the same "
                         "name as the table (for example `orders`). Keep the same result columns. Return runnable code only in `python`.\n\n"
                         f"```sql\n{sql}\n```", PYTHON_SCHEMA, effort="low")
            return SqlAiOut(action_id=r.action.id, python=r.data["python"], explanation=r.data["explanation"])

        if body.action == "write":
            prompt = f"Write a SQL query that answers: {question}\nIn `changes`, list the assumptions you made."
            kind = "sql_write"
        elif body.action == "fix":
            prompt = (f"This query failed.\n\n```sql\n{sql}\n```\n\nError: {error or '(no error message)'}\n\n"
                      "Return the corrected query. In `explanation`, say what was wrong; in `changes`, list each fix.")
            kind = "sql_fix"
        else:
            plan = ""
            con = connect_as(db, member, _datasets(db, member))
            try:
                plan = explain_sql(con, *bind(sql, body.params))[:4000]
            except QueryError:
                plan = "(the query can't be planned as it is)"
            finally:
                con.close()
            prompt = (f"Optimize this query for DuckDB without changing its result.\n\n```sql\n{sql}\n```\n\nDuckDB plan:\n{plan}\n\n"
                      "In `changes`, list each change and why it helps. If it's already good, return it unchanged and say so.")
            kind = "sql_optimize"
        r = ask_json(db, member, kind, system, prompt, SQL_SCHEMA)
        out_sql = r.data["sql"].strip()
        problem = check_sql(db, member, out_sql, body.params) if out_sql else None
        if out_sql and problem:
            # One repair round with DuckDB's own error.
            r2 = ask_json(db, member, kind, system,
                          f"{prompt}\n\nYour previous answer failed the workspace check:\n```sql\n{out_sql}\n```\nError: {redact_text(problem)}\n"
                          "Fix it using only the listed tables and columns.", SQL_SCHEMA)
            fixed = r2.data["sql"].strip()
            problem2 = check_sql(db, member, fixed, body.params) if fixed else "No SQL was produced."
            r, out_sql, problem = r2, fixed, problem2
        update_output(db, r.action, {**r.data, "valid": problem is None if out_sql else None})
        return SqlAiOut(action_id=r.action.id, sql=out_sql or None, explanation=r.data["explanation"], changes=r.data["changes"],
                        valid=(problem is None) if out_sql else None, check_error=problem if out_sql else None)
    except AiUnavailable as e:
        raise unavailable(e) from e
    except AiError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e


class ActionOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    kind: str
    model: str | None
    status: str
    outcome: str | None
    input_tokens: int | None
    output_tokens: int | None
    duration_ms: int | None
    ref_kind: str | None
    ref_id: str | None
    user_id: str | None
    created_at: UtcDatetime


class OutcomeIn(BaseModel):
    outcome: Literal["applied", "rejected"]


@router.get("/actions", response_model=list[ActionOut])
def list_actions(ref_id: str | None = None, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    stmt = select(AiAction).where(AiAction.workspace_id == member.workspace_id)
    if ref_id:
        stmt = stmt.where(AiAction.ref_id == ref_id)
    return db.scalars(stmt.order_by(AiAction.created_at.desc()).limit(200)).all()


@router.post("/actions/{action_id}/outcome", response_model=ActionOut)
def set_outcome(action_id: str, body: OutcomeIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    a = db.get(AiAction, action_id)
    if a is None or a.workspace_id != member.workspace_id or a.user_id != member.user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "AI action not found")
    if a.outcome in ("proposed", "applied", "rejected"):
        a.outcome = body.outcome
        db.commit()
    return a
