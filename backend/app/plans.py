"""Plans, entitlements and quotas. Billing is organization-level, not per person.

The plans live in `plans.json` (copied to the web app by `npm run plans:sync`), so prices and limits
change in one place. No payment provider is connected yet: organizations are moved between plans by
setting `Organization.plan`, and the web app labels paid plans "coming soon".

Usage is read from records the product already keeps (datasets, dashboards, pipeline runs, AI
actions), so there is no second ledger to drift. Limits only block creating new things; nothing is
ever deleted or hidden. Blocking happens only when PLAN_LIMITS_ENFORCED is on, so turning paid plans
on is a deliberate launch step rather than a side effect of a deploy.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AiAction, Dashboard, Dataset, Invitation, Organization, OrganizationMember, PipelineRun, Workspace, WorkspaceMember

BILLING_AVAILABLE = False  # flips when a payment provider is integrated
CONFIG_PATH = Path(__file__).with_name("plans.json")
METRICS = ("seats", "workspaces", "datasets", "dashboards", "storage_bytes", "ai_credits", "pipeline_runs")


@dataclass(frozen=True)
class Plan:
    id: str
    name: str
    description: str
    monthly_price: int | None  # None = custom pricing
    seats: int | None  # None = unlimited (or fair use)
    workspaces: int | None
    datasets: int | None
    dashboards: int | None
    storage_bytes: int | None
    ai_credits_per_month: int | None
    ai_credit_scope: str  # org | workspace
    pipeline_runs_per_day: int | None
    features: frozenset[str]
    support: str

    def annual_price(self, discount_percent: int) -> int | None:
        """The yearly amount: twelve months less the annual discount, rounded to whole rupees."""
        if self.monthly_price is None:
            return None
        return round(self.monthly_price * 12 * (100 - discount_percent) / 100)

    def limit(self, metric: str) -> int | None:
        return {
            "seats": self.seats, "workspaces": self.workspaces, "datasets": self.datasets, "dashboards": self.dashboards,
            "storage_bytes": self.storage_bytes, "ai_credits": self.ai_credits_per_month, "pipeline_runs": self.pipeline_runs_per_day,
        }[metric]


def _load() -> tuple[dict, dict[str, Plan]]:
    raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    known = set(raw["features"])
    plans: dict[str, Plan] = {}
    for p in raw["plans"]:
        unknown = set(p["features"]) - known
        if unknown:
            raise ValueError(f"plans.json: plan {p['id']} lists unknown features {sorted(unknown)}")
        if p["ai_credit_scope"] not in ("org", "workspace"):
            raise ValueError(f"plans.json: plan {p['id']} has a bad ai_credit_scope")
        plans[p["id"]] = Plan(
            id=p["id"], name=p["name"], description=p["description"], monthly_price=p["monthly_price"],
            seats=p["seats"], workspaces=p["workspaces"], datasets=p["datasets"], dashboards=p["dashboards"],
            storage_bytes=p["storage_bytes"], ai_credits_per_month=p["ai_credits_per_month"], ai_credit_scope=p["ai_credit_scope"],
            pipeline_runs_per_day=p["pipeline_runs_per_day"], features=frozenset(p["features"]), support=p["support"],
        )
    if "free" not in plans:
        raise ValueError("plans.json needs a free plan")
    if set(raw["ai_credit_costs"]) != {t["kind"] for t in raw["ai_credit_tasks"]}:
        raise ValueError("plans.json: ai_credit_costs and ai_credit_tasks must list the same kinds")
    return raw, plans


CONFIG, PLANS = _load()
ORDER = [p["id"] for p in CONFIG["plans"]]
AI_CREDIT_COSTS: dict[str, int] = CONFIG["ai_credit_costs"]


def enforced() -> bool:
    from app.config import get_settings

    return get_settings().plan_limits_enforced


def plan_of(org: Organization | None) -> Plan:
    return PLANS.get(org.plan, PLANS["free"]) if org is not None else PLANS["free"]


def org_of_member(db: Session, member: WorkspaceMember) -> Organization | None:
    return db.get(Organization, member.organization_id) if member.organization_id else None


def org_for_workspace(db: Session, workspace_id: str) -> Organization | None:
    ws = db.get(Workspace, workspace_id)
    return db.get(Organization, ws.organization_id) if ws is not None and ws.organization_id else None


def required_plan(feature: str) -> str | None:
    """The cheapest plan that includes a feature."""
    return next((pid for pid in ORDER if feature in PLANS[pid].features), None)


def _plan_above(metric: str, used_total: int, plan: Plan) -> str | None:
    """The cheapest plan above the current one whose limit fits `used_total`."""
    start = ORDER.index(plan.id) + 1 if plan.id in ORDER else 0
    for pid in ORDER[start:]:
        lim = PLANS[pid].limit(metric)
        if lim is None or used_total <= lim:
            return pid
    return None


# ---------- usage ----------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def month_start(now: datetime | None = None) -> datetime:
    n = now or _now()
    return n.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def day_start(now: datetime | None = None) -> datetime:
    n = now or _now()
    return n.replace(hour=0, minute=0, second=0, microsecond=0)


def resets_at(metric: str, now: datetime | None = None) -> datetime | None:
    if metric == "ai_credits":
        return (month_start(now) + timedelta(days=32)).replace(day=1)
    if metric == "pipeline_runs":
        return day_start(now) + timedelta(days=1)
    return None


def seat_limit(org: Organization) -> int | None:
    return org.seat_limit if org.seat_limit is not None else plan_of(org).seats


def seats_used(db: Session, organization_id: str) -> int:
    """Active members plus open invitations: an invitation holds a seat until it's accepted or revoked."""
    members = db.scalar(
        select(func.count()).where(OrganizationMember.organization_id == organization_id, OrganizationMember.status == "active")
    )
    pending = db.scalar(
        select(func.count()).where(
            Invitation.organization_id == organization_id, Invitation.status == "pending", Invitation.expires_at > _now(),
        )
    )
    return int(members or 0) + int(pending or 0)


@contextmanager
def _org_wide(db: Session) -> Iterator[Session]:
    """Organization-wide counts span workspaces, which row-level security would hide from a request's
    session. Lift it for these reads only (each is filtered to one organization), then restore."""
    from app import tenancy

    was_bypassed, workspace_id = db.info.get("rls_bypass"), db.info.get("rls_workspace_id")
    tenancy.bypass(db)
    try:
        yield db
    finally:
        if not was_bypassed:
            tenancy.bind(db, workspace_id)


def _ws_ids(s: Session, organization_id: str) -> list[str]:
    return list(s.scalars(select(Workspace.id).where(Workspace.organization_id == organization_id, Workspace.deleted_at.is_(None))))


def used(db: Session, org: Organization, metric: str, workspace_id: str | None = None) -> int:
    """Current usage of one metric for an organization (AI credits: for one workspace when the plan says so)."""
    if metric == "seats":
        return seats_used(db, org.id)
    with _org_wide(db) as s:
        ws = _ws_ids(s, org.id)
        if metric == "workspaces":
            return len(ws)
        if not ws:
            return 0
        if metric == "datasets":
            return int(s.scalar(select(func.count()).where(Dataset.workspace_id.in_(ws))) or 0)
        if metric == "dashboards":
            return int(s.scalar(select(func.count()).where(Dashboard.workspace_id.in_(ws))) or 0)
        if metric == "storage_bytes":
            return int(s.scalar(select(func.coalesce(func.sum(Dataset.file_size), 0)).where(Dataset.workspace_id.in_(ws))) or 0)
        if metric == "pipeline_runs":
            return int(s.scalar(select(func.count()).where(PipelineRun.workspace_id.in_(ws), PipelineRun.created_at >= day_start(), PipelineRun.status != "skipped")) or 0)
        if metric == "ai_credits":
            scope = [workspace_id] if plan_of(org).ai_credit_scope == "workspace" and workspace_id else ws
            return int(s.scalar(
                select(func.coalesce(func.sum(AiAction.credits), 0)).where(
                    AiAction.workspace_id.in_(scope), AiAction.created_at >= month_start(), AiAction.status.in_(("ok", "pending")),
                )
            ) or 0)
    raise ValueError(f"unknown metric {metric}")


# ---------- checks ----------

_LABELS = {
    "seats": "seats", "workspaces": "workspaces", "datasets": "datasets", "dashboards": "dashboards",
    "storage_bytes": "bytes of storage", "ai_credits": "AI credits a month", "pipeline_runs": "pipeline runs a day",
}


def _limit_error(org: Organization, metric: str, limit: int, used_now: int, adding: int) -> HTTPException:
    plan = plan_of(org)
    reset = resets_at(metric)
    if metric == "storage_bytes":
        what = f"{limit / 1024**3:.1f} GB of storage"
    else:
        what = f"{limit:,} {_LABELS[metric]}"
    tail = f" It resets on {reset:%d %b}." if reset else " Remove something, or upgrade for more."
    return HTTPException(status.HTTP_402_PAYMENT_REQUIRED, {
        "code": "plan_limit",
        "message": f"Your {plan.name} plan includes {what}.{tail}",
        "metric": metric, "limit": limit, "used": used_now,
        "required_plan": _plan_above(metric, used_now + adding, plan),
        "resets_at": reset.isoformat() if reset else None,
    })


def check_quota(db: Session, org: Organization | None, metric: str, adding: int = 1, workspace_id: str | None = None) -> None:
    """Raise 402 `plan_limit` if adding `adding` would go over the plan. No-op unless limits are enforced."""
    if org is None:
        return
    # An organization's own seat_limit is a deliberate per-organization setting and always holds;
    # the plan's default limits wait for PLAN_LIMITS_ENFORCED.
    explicit_seats = metric == "seats" and org.seat_limit is not None
    if not (enforced() or explicit_seats):
        return
    limit = seat_limit(org) if metric == "seats" else plan_of(org).limit(metric)
    if limit is None:
        return
    now_used = used(db, org, metric, workspace_id)
    if now_used + adding > limit:
        raise _limit_error(org, metric, limit, now_used, adding)


def check_member_quota(db: Session, member: WorkspaceMember, metric: str, adding: int = 1) -> None:
    check_quota(db, org_of_member(db, member), metric, adding, member.workspace_id)


def require_feature(db: Session, member: WorkspaceMember, feature: str) -> None:
    """Raise 402 `plan_feature` if the organization's plan doesn't include a feature."""
    if feature not in CONFIG["features"]:
        raise ValueError(f"unknown feature {feature}")
    if not enforced():
        return
    plan = plan_of(org_of_member(db, member))
    if feature not in plan.features:
        needed = required_plan(feature)
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, {
            "code": "plan_feature",
            "message": f"{CONFIG['features'][feature]} is part of the {PLANS[needed].name if needed else 'Enterprise'} plan.",
            "feature": feature, "required_plan": needed,
        })


def check_seats(db: Session, org: Organization, adding: int) -> None:
    check_quota(db, org, "seats", adding)


def check_workspaces(db: Session, org: Organization) -> None:
    check_quota(db, org, "workspaces")


# ---------- AI credits ----------

_ai_locks: dict[str, threading.Lock] = {}
_ai_locks_guard = threading.Lock()


def _org_lock(org_id: str) -> threading.Lock:
    with _ai_locks_guard:
        return _ai_locks.setdefault(org_id, threading.Lock())


def reserve_ai_credits(db: Session, member: WorkspaceMember, action: AiAction) -> None:
    """Hold this request's credits before the provider is called, so parallel requests can't overspend.

    The action is saved as `pending` with its cost; the caller settles it (`ok` keeps the charge, any
    failure sets credits to 0). Unknown kinds cost nothing rather than guessing.
    """
    action.credits = AI_CREDIT_COSTS.get(action.kind, 0)
    action.status = "pending"
    org = org_of_member(db, member)
    if org is None:
        db.add(action)
        db.commit()
        return
    with _org_lock(org.id):
        # Postgres: the row lock serializes reservations across API processes; SQLite has one writer.
        db.execute(select(Organization.id).where(Organization.id == org.id).with_for_update())
        try:
            check_quota(db, org, "ai_credits", action.credits, member.workspace_id)
        except HTTPException:
            db.rollback()
            raise
        db.add(action)
        db.commit()


# ---------- summary ----------


def summary(db: Session, org: Organization, workspace_id: str | None = None) -> dict:
    p = plan_of(org)
    usage = []
    for m in METRICS:
        lim = seat_limit(org) if m == "seats" else p.limit(m)
        u = used(db, org, m, workspace_id)
        reset = resets_at(m)
        usage.append({
            "metric": m, "used": u, "limit": lim,
            "percent": None if not lim else min(100, round(u * 100 / lim)),
            "resets_at": reset.isoformat() if reset else None,
        })
    return {
        "plan": {"id": p.id, "name": p.name, "monthly_price": p.monthly_price, "support": p.support,
                 "annual_price": p.annual_price(CONFIG["annual_discount_percent"]), "currency": CONFIG["currency"]},
        "status": org.plan_status,
        "trial_ends_at": org.trial_ends_at,
        "billing_available": BILLING_AVAILABLE,
        "enforced": enforced(),
        "ai_credit_scope": p.ai_credit_scope,
        "usage": usage,
    }
