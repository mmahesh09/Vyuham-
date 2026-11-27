"""First-run setup: create the organization and its default workspace, then personalize it.

Creating is idempotent. The web app sends a `creation_key` (a random id it keeps for the session), so
a retried or double-clicked request returns the organization the first one made. Someone who already
started setting up an organization gets that one back instead of a second.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import tenancy
from app.audit import record_org_action
from app.db import get_db
from app.models import Organization, OrganizationMember, Workspace, WorkspaceMember
from app.permissions import Perm, require
from app.routers.organizations import CompanySize, Preferences, apply_preferences
from app.security import AuthUser, current_membership, current_user

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


class OnboardingOrg(BaseModel):
    id: str
    name: str
    company_size: str | None
    industry: str | None
    intended_use: list[str]
    completed: bool


class OnboardingWorkspace(BaseModel):
    id: str
    name: str
    preferences: dict


class OnboardingState(BaseModel):
    needs_onboarding: bool
    step: Literal["organization", "invite", "personalize", "done"]
    organization: OnboardingOrg | None = None
    workspace: OnboardingWorkspace | None = None


def _unfinished_org(db: Session, user_id: str) -> Organization | None:
    """An organization this person owns and hasn't finished setting up."""
    return db.scalar(
        select(Organization)
        .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
        .where(
            OrganizationMember.user_id == user_id, OrganizationMember.role == "owner", OrganizationMember.status == "active",
            Organization.deleted_at.is_(None), Organization.onboarding_completed_at.is_(None),
        )
        .order_by(Organization.created_at.desc())
    )


def _default_ws(db: Session, org: Organization) -> Workspace | None:
    return db.scalar(
        select(Workspace).where(Workspace.organization_id == org.id, Workspace.deleted_at.is_(None))
        .order_by(Workspace.is_default.desc(), Workspace.created_at)
    )


def _state(db: Session, user_id: str) -> OnboardingState:
    org = _unfinished_org(db, user_id)
    if org is None:
        if tenancy.accessible_workspaces(db, user_id):
            return OnboardingState(needs_onboarding=False, step="done")
        return OnboardingState(needs_onboarding=True, step="organization")
    ws = _default_ws(db, org)
    has_prefs = bool(ws and (ws.preferences or {}).get("onboarding_step") == "personalize")
    return OnboardingState(
        needs_onboarding=True,
        step="personalize" if has_prefs else "invite",
        organization=OnboardingOrg(
            id=org.id, name=org.name, company_size=org.company_size, industry=org.industry,
            intended_use=org.intended_use or [], completed=False,
        ),
        workspace=OnboardingWorkspace(id=ws.id, name=ws.name, preferences=ws.preferences or {}) if ws else None,
    )


def needs_onboarding(db: Session, user_id: str) -> bool:
    return _state(db, user_id).needs_onboarding


@router.get("", response_model=OnboardingState)
def get_state(user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    return _state(db, user.id)


class OrganizationIn(BaseModel):
    creation_key: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    company_name: str = Field(min_length=1, max_length=120)
    workspace_name: str | None = Field(default=None, max_length=120)
    company_size: CompanySize | None = None
    industry: str | None = Field(default=None, max_length=60)
    intended_use: list[str] = Field(default_factory=list, max_length=12)


def _clean(body: OrganizationIn) -> dict:
    return {
        "name": body.company_name.strip(),
        "company_size": body.company_size,
        "industry": (body.industry or "").strip() or None,
        "intended_use": [u.strip()[:40] for u in body.intended_use if u.strip()],
    }


@router.post("/organization", response_model=OnboardingState)
def create_organization(body: OrganizationIn, user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    fields = _clean(body)
    if not fields["name"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Enter your company or organization name.")
    ws_name = (body.workspace_name or "").strip() or f"{fields['name']} workspace"

    # A retry of the same request, or a second "create" while one is unfinished: update, don't duplicate.
    existing = db.scalar(select(Organization).where(Organization.created_by == user.id, Organization.creation_key == body.creation_key))
    existing = existing if existing is not None and existing.deleted_at is None else _unfinished_org(db, user.id)
    if existing is not None:
        for k, v in fields.items():
            setattr(existing, k, v)
        ws = _default_ws(db, existing)
        if ws is not None:
            ws.name = ws_name[:120]
        db.commit()
        return _state(db, user.id)

    try:
        org, ws = tenancy.create_organization(
            db, user.id, fields["name"], ws_name, creation_key=body.creation_key,
            company_size=fields["company_size"], industry=fields["industry"], intended_use=fields["intended_use"],
        )
        record_org_action(db, org.id, user.id, "org.create", "organization", org.id, workspace_id=ws.id)
        record_org_action(db, org.id, user.id, "workspace.create", "workspace", ws.id, {"name": ws.name}, workspace_id=ws.id)
        db.commit()
    except IntegrityError:  # the same key raced in from a parallel request: theirs won
        db.rollback()
    return _state(db, user.id)


class PersonalizeIn(Preferences):
    pass


def _owner_setup(db: Session, user: AuthUser, member: WorkspaceMember) -> Organization:
    org = db.get(Organization, member.organization_id) if member.organization_id else None
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
    require(member, Perm.WORKSPACE_SETTINGS, "Only owners and admins can set up the workspace.")
    return org


@router.patch("/personalize", response_model=OnboardingState)
def personalize(body: PersonalizeIn, user: AuthUser = Depends(current_user), member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _owner_setup(db, user, member)
    ws = db.get(Workspace, member.workspace_id)
    apply_preferences(ws, body)
    prefs = dict(ws.preferences or {})
    prefs["onboarding_step"] = "personalize"
    ws.preferences = prefs
    db.commit()
    return _state(db, user.id)


@router.post("/invite-step", response_model=OnboardingState)
def invite_step_done(user: AuthUser = Depends(current_user), member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """The invite step was finished or skipped; resuming onboarding goes to Personalize next."""
    _owner_setup(db, user, member)
    ws = db.get(Workspace, member.workspace_id)
    prefs = dict(ws.preferences or {})
    prefs["onboarding_step"] = "personalize"
    ws.preferences = prefs
    db.commit()
    return _state(db, user.id)


@router.post("/complete", response_model=OnboardingState)
def complete(user: AuthUser = Depends(current_user), member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    org = _owner_setup(db, user, member)
    if org.onboarding_completed_at is None:
        org.onboarding_completed_at = _now()
        ws = db.get(Workspace, member.workspace_id)
        prefs = dict(ws.preferences or {})
        prefs.pop("onboarding_step", None)
        ws.preferences = prefs
        db.commit()
    return _state(db, user.id)
