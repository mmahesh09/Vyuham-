"""Governance Center: overview, sensitive data findings, classification, policies, access control and audit.

Owners and admins manage policies, labels and permissions; analysts can read the overview and findings and run a
scan. Every change here is written to the audit log in the same transaction.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import plans
from app import governance as gov
from app.audit import record_action
from app.auth_tables import user_table
from app.db import get_db
from app.models import AccessGrant, AuditLog, ColumnClassification, Dataset, GovernancePolicy, QueryExecution, WorkspaceMember
from app.routers.datasets import owned_dataset
from app.schemas import UtcDatetime
from app.permissions import FULL_ACCESS
from app.security import current_membership

router = APIRouter(prefix="/governance", tags=["governance"])

Label = Literal["public", "internal", "confidential", "restricted"]
PiiType = Literal["email", "phone", "person_name", "address", "financial", "government_id", "sensitive"]
Method = Literal["partial", "hash", "redact", "full", "hide"]
GrantRole = Literal["analyst", "viewer", "public"]


def _reader(member: WorkspaceMember) -> None:
    if member.role not in ("owner", "admin", "analyst"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "The Governance Center is for analysts, admins and owners.")


def _owner(member: WorkspaceMember) -> None:
    if member.role not in FULL_ACCESS:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only owners and admins can change governance settings.")


def _datasets(db: Session, ws: str) -> dict[str, Dataset]:
    return {d.id: d for d in db.scalars(select(Dataset).where(Dataset.workspace_id == ws))}


def _names(db: Session, ids: set[str]) -> dict[str, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {r.id: r.name for r in db.execute(select(user_table.c.id, user_table.c.name).where(user_table.c.id.in_(ids)))}


# ---------- overview ----------


@router.get("/overview")
def overview(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _reader(member)
    ws = member.workspace_id
    ds = _datasets(db, ws)
    classes = db.scalars(select(ColumnClassification).where(ColumnClassification.workspace_id == ws)).all()
    active = [c for c in classes if c.status == "active" and c.dataset_id in ds]
    by_label = {lbl: sum(1 for c in active if c.label == lbl) for lbl in gov.LABELS}
    by_type = {t: sum(1 for c in active if c.pii_type == t) for t in gov.PII_TYPES}
    policies = db.scalars(select(GovernancePolicy).where(GovernancePolicy.workspace_id == ws)).all()
    grants = db.scalar(select(func.count(AccessGrant.id)).where(AccessGrant.workspace_id == ws)) or 0
    roles = dict(db.execute(select(WorkspaceMember.role, func.count()).where(WorkspaceMember.workspace_id == ws).group_by(WorkspaceMember.role)).all())
    masking = [p for p in policies if p.kind == "masking" and p.enabled]
    sensitive_ds = {c.dataset_id for c in active if c.label in ("confidential", "restricted")}
    unprotected = []
    for c in active:
        if c.label not in ("confidential", "restricted"):
            continue
        roles_seeing = [r for r in ("analyst", "viewer", "public") if not any(gov.policy_method(p.rules or {}, c.label, c.pii_type, r) for p in masking)]
        if "viewer" in roles_seeing or "public" in roles_seeing:
            unprotected.append({"dataset_id": c.dataset_id, "dataset": ds[c.dataset_id].name, "column": c.column, "label": c.label,
                                "pii_type": c.pii_type, "visible_to": roles_seeing})
    since = datetime.now(timezone.utc) - timedelta(days=7)
    recent = db.scalar(select(func.count(AuditLog.id)).where(AuditLog.workspace_id == ws, AuditLog.created_at >= since)) or 0
    exports = db.scalar(select(func.count(AuditLog.id)).where(AuditLog.workspace_id == ws, AuditLog.action == "data.export", AuditLog.created_at >= since)) or 0
    scanned = {c.dataset_id for c in classes}
    return {
        "datasets": len(ds), "datasets_with_sensitive_data": len(sensitive_ds), "classified_columns": len(active),
        "by_label": by_label, "by_type": by_type, "policies": {"masking": len(masking), "total": len(policies)},
        "grants": grants, "members_by_role": roles, "unprotected": unprotected[:50],
        "never_scanned": [{"id": d.id, "name": d.name} for d in ds.values() if d.id not in scanned][:50],
        "audit_events_7d": recent, "exports_7d": exports,
        "enforcement": "Access rules and masking are applied inside the query engine for every query, preview, export, "
                       "dashboard, shared link and AI request. Owners always see full values.",
    }


# ---------- scanner + classification ----------


class ScanIn(BaseModel):
    dataset_ids: list[str] | None = Field(default=None, max_length=500)


@router.post("/scan")
def scan(body: ScanIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Look for sensitive data. Counts are stored, never the values. Creates two recommended masking policies on first use."""
    _reader(member)
    ds = _datasets(db, member.workspace_id)
    targets = [ds[i] for i in body.dataset_ids if i in ds] if body.dataset_ids else list(ds.values())
    result = gov.scan_workspace(db, member.workspace_id, targets, member.user_id)
    record_action(db, member, "governance.scan", "workspace", member.workspace_id, {k: v for k, v in result.items()})
    db.commit()
    return result


class ClassOut(BaseModel):
    id: str
    dataset_id: str
    dataset: str
    layer: str | None
    column: str
    column_type: str | None
    label: str
    pii_type: str | None
    source: str
    confidence: float | None
    matched: int | None
    sampled: int | None
    status: str
    updated_at: UtcDatetime
    masked_for: dict[str, str | None]


@router.get("/classifications", response_model=list[ClassOut])
def classifications(include_dismissed: bool = False, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _reader(member)
    ws = member.workspace_id
    ds = _datasets(db, ws)
    access = {r: gov.access_for(db, ws, r) for r in ("analyst", "viewer", "public")}
    out = []
    for c in db.scalars(select(ColumnClassification).where(ColumnClassification.workspace_id == ws).order_by(ColumnClassification.label.desc())).all():
        if c.dataset_id not in ds or (c.status == "dismissed" and not include_dismissed):
            continue
        d = ds[c.dataset_id]
        col_type = next((x.get("type") for x in d.columns if x["name"] == c.column), None)
        out.append(ClassOut(
            id=c.id, dataset_id=c.dataset_id, dataset=d.name, layer=d.layer, column=c.column, column_type=col_type, label=c.label,
            pii_type=c.pii_type, source=c.source, confidence=c.confidence, matched=c.matched, sampled=c.sampled, status=c.status,
            updated_at=c.updated_at, masked_for={r: ("hidden" if (access[r].get(c.dataset_id) and access[r][c.dataset_id].hidden) else gov.column_method(access[r], c.dataset_id, c.column)) for r in access},
        ))
    rank = {lbl: i for i, lbl in enumerate(gov.LABELS)}
    out.sort(key=lambda c: (-rank.get(c.label, 0), c.dataset, c.column))
    return out


class ClassIn(BaseModel):
    dataset_id: str
    column: str = Field(min_length=1, max_length=200)
    label: Label
    pii_type: PiiType | None = None
    status: Literal["active", "dismissed"] = "active"


@router.put("/classifications", response_model=dict)
def set_classification(body: ClassIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _owner(member)
    ds = owned_dataset(db, member, body.dataset_id)
    if not any(c["name"] == body.column for c in ds.columns):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That column isn't in the dataset.")
    c = db.scalar(select(ColumnClassification).where(ColumnClassification.dataset_id == ds.id, ColumnClassification.column == body.column))
    before = {"label": c.label, "pii_type": c.pii_type, "status": c.status} if c else None
    if c is None:
        c = ColumnClassification(workspace_id=member.workspace_id, dataset_id=ds.id, column=body.column)
        db.add(c)
    c.label, c.pii_type, c.status, c.source, c.updated_by = body.label, body.pii_type, body.status, "manual", member.user_id
    record_action(db, member, "classification.update", "dataset", ds.id,
                  {"column": body.column, "before": before, "after": {"label": body.label, "pii_type": body.pii_type, "status": body.status}})
    db.commit()
    return {"ok": True}


# ---------- policies ----------


class PolicyIn(BaseModel):
    kind: Literal["masking", "classification", "retention"]
    name: str = Field(min_length=1, max_length=120)
    rules: dict
    enabled: bool = True


class PolicyOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    kind: str
    name: str
    rules: dict
    enabled: bool
    created_at: UtcDatetime
    updated_at: UtcDatetime


def _check_rules(kind: str, rules: dict) -> dict:
    """Keep only known fields, with valid values."""
    if kind == "masking":
        labels = [x for x in rules.get("labels") or [] if x in gov.LABELS]
        types = [x for x in rules.get("pii_types") or [] if x in gov.PII_TYPES]
        if not labels and not types:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Choose at least one label or data type for the policy to cover.")
        method = rules.get("method", "full")
        if method not in gov.METHODS:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown masking method.")
        exempt = [r for r in rules.get("exempt_roles") or [] if r in ("analyst", "viewer")]
        return {"labels": labels, "pii_types": types, "method": method, "exempt_roles": exempt}
    if kind == "classification":
        # Column-name patterns that get a label on the next scan (applied by the scanner as manual suggestions).
        patterns = [{"pattern": str(p.get("pattern"))[:100], "label": p.get("label"), "pii_type": p.get("pii_type")}
                    for p in rules.get("patterns") or [] if p.get("pattern") and p.get("label") in gov.LABELS]
        if not patterns:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Add at least one column-name pattern and label.")
        return {"patterns": patterns[:50]}
    out = {}
    for key in ("audit_days", "query_history_days", "run_history_days", "ai_history_days"):
        v = rules.get(key)
        if v is not None:
            if not isinstance(v, int) or not 7 <= v <= 3650:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Retention periods must be whole days between 7 and 3650.")
            out[key] = v
    if not out:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Set at least one retention period.")
    return out


@router.get("/policies", response_model=list[PolicyOut])
def policies(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _reader(member)
    return db.scalars(select(GovernancePolicy).where(GovernancePolicy.workspace_id == member.workspace_id).order_by(GovernancePolicy.kind, GovernancePolicy.created_at)).all()


@router.post("/policies", response_model=PolicyOut, status_code=status.HTTP_201_CREATED)
def create_policy(body: PolicyIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _owner(member)
    p = GovernancePolicy(workspace_id=member.workspace_id, kind=body.kind, name=body.name.strip(), rules=_check_rules(body.kind, body.rules),
                         enabled=body.enabled, created_by=member.user_id)
    db.add(p)
    db.flush()
    record_action(db, member, "policy.create", "policy", p.id, {"kind": p.kind, "name": p.name, "rules": p.rules})
    db.commit()
    db.refresh(p)
    return p


def _policy(db: Session, member: WorkspaceMember, pid: str) -> GovernancePolicy:
    p = db.get(GovernancePolicy, pid)
    if p is None or p.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Policy not found")
    return p


@router.put("/policies/{pid}", response_model=PolicyOut)
def update_policy(pid: str, body: PolicyIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _owner(member)
    p = _policy(db, member, pid)
    before = {"name": p.name, "rules": p.rules, "enabled": p.enabled}
    p.name, p.rules, p.enabled = body.name.strip(), _check_rules(p.kind, body.rules), body.enabled
    record_action(db, member, "policy.update", "policy", p.id, {"before": before, "after": {"name": p.name, "rules": p.rules, "enabled": p.enabled}})
    db.commit()
    db.refresh(p)
    return p


@router.delete("/policies/{pid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_policy(pid: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _owner(member)
    p = _policy(db, member, pid)
    record_action(db, member, "policy.delete", "policy", p.id, {"kind": p.kind, "name": p.name, "rules": p.rules})
    db.delete(p)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- access control ----------


class GrantIn(BaseModel):
    dataset_id: str
    column: str = Field(default="", max_length=200)
    role: GrantRole
    access: Literal["none", "masked", "read", "default"]


@router.get("/access")
def access(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Permission review: members and roles, explicit grants, and what each role effectively sees per dataset."""
    _reader(member)
    ws = member.workspace_id
    ds = _datasets(db, ws)
    members = db.scalars(select(WorkspaceMember).where(WorkspaceMember.workspace_id == ws)).all()
    names = _names(db, {m.user_id for m in members})
    emails = {r.id: r.email for r in db.execute(select(user_table.c.id, user_table.c.email).where(user_table.c.id.in_([m.user_id for m in members])))} if members else {}
    grants = db.scalars(select(AccessGrant).where(AccessGrant.workspace_id == ws)).all()
    eff = {r: gov.access_for(db, ws, r) for r in ("analyst", "viewer", "public")}
    matrix = []
    for d in ds.values():
        row = {"dataset_id": d.id, "dataset": d.name, "layer": d.layer, "roles": {"owner": {"access": "full", "masked_columns": 0, "hidden_columns": 0}}}
        for r, a in eff.items():
            acc = a.get(d.id)
            if acc is not None and acc.hidden:
                row["roles"][r] = {"access": "none", "masked_columns": 0, "hidden_columns": 0}
                continue
            cols = [gov.column_method(a, d.id, c["name"]) for c in d.columns]
            row["roles"][r] = {"access": "partial" if any(cols) else "full", "masked_columns": sum(1 for m in cols if m and m != "hide"),
                               "hidden_columns": sum(1 for m in cols if m == "hide")}
        matrix.append(row)
    return {
        "members": [{"user_id": m.user_id, "name": names.get(m.user_id, "Member"), "email": emails.get(m.user_id), "role": m.role} for m in members],
        "grants": [{"id": g.id, "dataset_id": g.dataset_id, "dataset": ds[g.dataset_id].name if g.dataset_id in ds else "(deleted)",
                    "column": g.column, "role": g.role, "access": g.access, "created_at": g.created_at} for g in grants],
        "matrix": matrix,
        "roles": {"owner": "Full access to everything, always.", "admin": "Full access to data; manages members and settings.", "analyst": "Builds with data; can run SQL and pipelines.",
                  "viewer": "Reads dashboards and datasets.", "public": "Anyone with a shared dashboard link."},
    }


@router.put("/access")
def set_grant(body: GrantIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _owner(member)
    ds = owned_dataset(db, member, body.dataset_id)
    if body.column and not any(c["name"] == body.column for c in ds.columns):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That column isn't in the dataset.")
    g = db.scalar(select(AccessGrant).where(AccessGrant.dataset_id == ds.id, AccessGrant.column == body.column, AccessGrant.role == body.role))
    before = g.access if g else "default"
    if body.access == "default":
        if g is not None:
            db.delete(g)
    else:
        if g is None:
            g = AccessGrant(workspace_id=member.workspace_id, dataset_id=ds.id, column=body.column, role=body.role, created_by=member.user_id)
            db.add(g)
        g.access = body.access
    record_action(db, member, "permission.update", "dataset", ds.id,
                  {"column": body.column or None, "role": body.role, "before": before, "after": body.access})
    db.commit()
    return {"ok": True}


@router.get("/preview/{dataset_id}")
def preview_as(dataset_id: str, role: GrantRole = "viewer", member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """The first rows of a dataset exactly as a role would see them (owners only), to check policies."""
    from app.query import connect, records, view_name

    _owner(member)
    ds = owned_dataset(db, member, dataset_id)
    a = gov.access_for(db, member.workspace_id, role)
    if a.get(ds.id) and a[ds.id].hidden:
        return {"hidden": True, "columns": [], "rows": []}
    con = connect(member.workspace_id, [ds], access=a)
    try:
        cur = con.execute(f"SELECT * FROM {view_name(ds.id)} LIMIT 20")  # nosec B608 - server-built view name
        cols = [d[0] for d in cur.description]
        rows = records(cols, cur.fetchall())
    except Exception:
        return {"hidden": False, "columns": [], "rows": [], "error": "This dataset couldn't be read."}
    finally:
        con.close()
    return {"hidden": False, "columns": cols, "rows": rows, "masked": {c: gov.column_method(a, ds.id, c) for c in cols if gov.column_method(a, ds.id, c)}}


# ---------- audit ----------

AUDIT_GROUPS = {
    "permissions": ("permission.", "member.", "invite.", "team."),
    "policies": ("policy.", "classification.", "governance."),
    "exports": ("data.export", "report."),
}


@router.get("/audit")
def audit(
    group: Literal["all", "access", "permissions", "policies", "exports"] = "all",
    days: int = Query(30, ge=1, le=365),
    member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db),
):
    """Who accessed data, changed permissions or policies, and exported data, with when."""
    _owner(member)
    plans.require_feature(db, member, "governance.audit_logs")
    ws = member.workspace_id
    since = datetime.now(timezone.utc) - timedelta(days=days)
    ds = _datasets(db, ws)
    events = []
    if group in ("all", "permissions", "policies", "exports"):
        rows = db.scalars(select(AuditLog).where(AuditLog.workspace_id == ws, AuditLog.created_at >= since).order_by(AuditLog.created_at.desc()).limit(500)).all()
        for r in rows:
            if group != "all" and not r.action.startswith(AUDIT_GROUPS[group]):
                continue
            events.append({"type": "change" if not r.action.startswith("data.export") else "export", "action": r.action, "user_id": r.user_id,
                           "target_type": r.target_type, "target_id": r.target_id,
                           "target": ds[r.target_id].name if r.target_type == "dataset" and r.target_id in ds else None,
                           "detail": r.detail, "at": r.created_at})
    if group in ("all", "access"):
        q = db.scalars(select(QueryExecution).where(QueryExecution.workspace_id == ws, QueryExecution.created_at >= since,
                                                    QueryExecution.dataset_ids.is_not(None)).order_by(QueryExecution.created_at.desc()).limit(500)).all()
        for e in q:
            events.append({"type": "access", "action": f"data.read.{e.kind}", "user_id": e.user_id, "target_type": "dataset",
                           "target_id": (e.dataset_ids or [None])[0], "target": ", ".join(ds[i].name for i in (e.dataset_ids or []) if i in ds) or None,
                           "detail": {"rows": e.rows, "status": e.status, "duration_ms": e.duration_ms}, "at": e.created_at})
    events.sort(key=lambda x: x["at"], reverse=True)
    names = _names(db, {e["user_id"] for e in events})
    for e in events:
        e["user"] = names.get(e["user_id"] or "", "Scheduled job" if not e["user_id"] else "Former member")
        e["at"] = (e["at"] if e["at"].tzinfo else e["at"].replace(tzinfo=timezone.utc)).isoformat()
    return {"events": events[:500], "days": days}
