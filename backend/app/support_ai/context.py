"""Module-aware diagnostic context, built on the server from the customer's own workspace.

Never includes data rows, query results, dataset contents, credentials or webhook URLs. Only names,
configuration shape and error messages, all redacted. The customer sees this before sharing it.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Alert, AlertEvent, Automation, Dashboard, WorkspaceMember
from app.query import QueryError
from app.support_ai.redact import redact_sql, redact_text

MODULE_ALIASES = {"sql": "sql_lab", "sql_lab": "sql_lab", "dashboard": "dashboard", "dashboards": "dashboard", "automations": "automations", "alerts": "automations", "reports": "reports", "data": "datasets", "datasets": "datasets"}


def _chart_shape(spec: dict, kind: str) -> dict:
    """Chart configuration without any values: metric fields and aggregations, grouping, filter field names."""
    shape: dict = {"kind": kind, "title": redact_text(spec.get("title") or "")[:120]}
    if spec.get("sql"):
        shape["sql"] = redact_sql(spec["sql"])[:2000]
    if spec.get("metrics"):
        shape["metrics"] = [{"field": str(m.get("field", ""))[:80], "agg": str(m.get("agg", ""))[:16]} for m in spec["metrics"][:6] if isinstance(m, dict)]
    for key in ("groupBy", "timeBucket", "sort", "limit", "chartType"):
        if spec.get(key) not in (None, ""):
            shape[key] = spec[key] if isinstance(spec[key], (int, float)) else str(spec[key])[:80]
    if isinstance(spec.get("filters"), dict):
        shape["filter_fields"] = sorted(str(k)[:80] for k in spec["filters"])[:10]  # names only, never values
    return shape


def dashboard_context(db: Session, member: WorkspaceMember, dashboard_id: str) -> dict | None:
    from app.routers.dashboards import _view  # local import, as alerts.py does

    d = db.get(Dashboard, dashboard_id)
    if d is None or d.workspace_id != member.workspace_id:
        return None
    errors: dict[str, str] = {}
    try:
        view = _view(db, d, None, None, {})
        errors = {c.id: redact_text(c.error, mask_quoted=True) for c in view.charts if c.error}
    except (QueryError, Exception):  # noqa: BLE001 - context is best effort; never fail the assistant on it
        errors = {}
    charts = []
    for c in d.charts[:20]:
        item = _chart_shape(c.spec or {}, c.kind)
        if c.id in errors:
            item["error"] = errors[c.id]
        charts.append(item)
    return {"dashboard": redact_text(d.name)[:120], "charts": charts, "charts_with_errors": len(errors)}


def automations_context(db: Session, member: WorkspaceMember) -> dict:
    autos = db.scalars(select(Automation).where(Automation.workspace_id == member.workspace_id)).all()
    alerts = db.scalars(select(Alert).where(Alert.workspace_id == member.workspace_id, Alert.state == "error")).all()
    failing = [
        {"automation": redact_text(a.name)[:120], "last_status": redact_text(a.last_status, mask_quoted=True)[:300], "last_run_at": a.last_run_at.isoformat() if a.last_run_at else None}
        for a in autos
        if a.last_status and a.last_status != "Sent"
    ][:10]
    alert_errors = [{"alert": redact_text(a.name)[:120], "error": redact_text(a.last_error, mask_quoted=True)[:300]} for a in alerts][:10]
    return {"failing_automations": failing, "alerts_with_errors": alert_errors}


def reports_context(db: Session, member: WorkspaceMember) -> dict:
    """Scheduled dashboard reports (automation digests): recent runs whose delivery failed."""
    events = db.scalars(
        select(AlertEvent).where(AlertEvent.workspace_id == member.workspace_id, AlertEvent.automation_id.is_not(None)).order_by(AlertEvent.created_at.desc()).limit(20)
    ).all()
    failed = []
    for e in events:
        delivery = e.delivery or {}
        problems = {ch: redact_text(str(v), mask_quoted=True)[:200] for ch, v in delivery.items() if isinstance(v, str) and v.lower() != "ok"}
        if problems:
            failed.append({"report": redact_text(e.title)[:120], "delivery_problems": problems, "at": e.created_at.isoformat()})
    return {"failed_deliveries": failed[:10]}


def build_context(db: Session, member: WorkspaceMember, module: str, dashboard_id: str | None = None) -> dict:
    module = MODULE_ALIASES.get(module, "other")
    if module == "dashboard" and dashboard_id:
        return {"module": module, **(dashboard_context(db, member, dashboard_id) or {})}
    if module == "automations":
        return {"module": module, **automations_context(db, member)}
    if module == "reports":
        return {"module": module, **reports_context(db, member)}
    return {"module": module}
