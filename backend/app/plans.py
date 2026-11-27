"""Organization plans and their limits. Billing is organization-level, not per person.

No payment provider is connected yet: every organization is on Free during the beta, and the web app
labels upgrades "coming soon". These definitions are what a provider (Stripe, Razorpay) will set
`Organization.plan` / `plan_status` / `trial_ends_at` from later. `None` means unlimited.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Invitation, Organization, OrganizationMember, Workspace

BILLING_AVAILABLE = False  # flips when a payment provider is integrated


@dataclass(frozen=True)
class Plan:
    id: str
    name: str
    monthly_price_usd: int | None  # None = talk to sales
    seats: int | None
    workspaces: int | None
    datasets: int | None
    ai_queries_per_month: int | None


PLANS: dict[str, Plan] = {
    # Free is generous during the beta so no existing team is cut off.
    "free": Plan("free", "Free", 0, None, None, None, None),
    "starter": Plan("starter", "Starter", None, 10, 3, 200, 2_000),
    "growth": Plan("growth", "Growth", None, 50, 20, 2_000, 20_000),
    "enterprise": Plan("enterprise", "Enterprise", None, None, None, None, None),
}


def plan_of(org: Organization) -> Plan:
    return PLANS.get(org.plan, PLANS["free"])


def seat_limit(org: Organization) -> int | None:
    return org.seat_limit if org.seat_limit is not None else plan_of(org).seats


def seats_used(db: Session, organization_id: str) -> int:
    """Active members plus open invitations: an invitation holds a seat until it's accepted or revoked."""
    members = db.scalar(
        select(func.count()).where(OrganizationMember.organization_id == organization_id, OrganizationMember.status == "active")
    )
    pending = db.scalar(
        select(func.count()).where(
            Invitation.organization_id == organization_id, Invitation.status == "pending",
            Invitation.expires_at > datetime.now(timezone.utc),
        )
    )
    return int(members or 0) + int(pending or 0)


def check_seats(db: Session, org: Organization, adding: int) -> None:
    limit = seat_limit(org)
    if limit is not None and seats_used(db, org.id) + adding > limit:
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            f"Your {plan_of(org).name} plan includes {limit} seats. Remove someone or revoke an invitation first.",
        )


def check_workspaces(db: Session, org: Organization) -> None:
    limit = plan_of(org).workspaces
    if limit is None:
        return
    used = db.scalar(select(func.count()).where(Workspace.organization_id == org.id, Workspace.deleted_at.is_(None)))
    if (used or 0) >= limit:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, f"Your {plan_of(org).name} plan includes {limit} workspaces.")


def summary(db: Session, org: Organization) -> dict:
    p = plan_of(org)
    ws_used = db.scalar(select(func.count()).where(Workspace.organization_id == org.id, Workspace.deleted_at.is_(None)))
    return {
        "plan": asdict(p),
        "status": org.plan_status,
        "trial_ends_at": org.trial_ends_at,
        "billing_available": BILLING_AVAILABLE,
        "usage": {"seats": seats_used(db, org.id), "workspaces": int(ws_used or 0)},
        "limits": {"seats": seat_limit(org), "workspaces": p.workspaces, "datasets": p.datasets, "ai_queries_per_month": p.ai_queries_per_month},
        "plans": [asdict(x) for x in PLANS.values()],
    }
