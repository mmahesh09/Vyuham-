"""Invitations: owners and admins invite people by email to the organization and one of its workspaces.

Security rules:
- The token is 256 bits from `secrets`; only its SHA-256 is stored. It is in the emailed link and shown
  once to the person who sent it (so it can be copied when email isn't set up).
- An invitation can only be accepted by a signed-in person whose verified email is the invited address.
- Accepting never grants more than the invitation says, and never lowers a role someone already has.
- Expired, revoked and used invitations can't be accepted; the claim is one atomic UPDATE.
- One open invitation per email per organization (a partial unique index backs this up).
"""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import plans, tenancy
from app.audit import record_org_action
from app.auth_tables import user_table
from app.config import get_settings
from app.db import get_db
from app.models import Invitation, Organization, OrganizationMember, Workspace, WorkspaceMember
from app.permissions import FULL_ACCESS, Perm, rank, require
from app.schemas import UtcDatetime
from app.security import AuthUser, current_membership, current_user, require_verified_email

router = APIRouter(tags=["invitations"])
log = logging.getLogger("app.invitations")

InviteRole = Literal["admin", "analyst", "viewer"]
EMAIL = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
RESEND_COOLDOWN = timedelta(seconds=60)
ROLE_WORDS = {"admin": "an admin", "analyst": "an analyst", "viewer": "a viewer"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _new_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    return token, token_hash(token)


def _accept_url(token: str) -> str:
    from app.email import app_link

    return app_link(f"/invite/{token}")


def _ttl() -> timedelta:
    return timedelta(days=get_settings().invite_ttl_days)


def _org_of(db: Session, member: WorkspaceMember) -> Organization:
    org = db.get(Organization, member.organization_id) if member.organization_id else None
    if org is None or org.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
    return org


def _inviter_name(db: Session, user_id: str | None) -> str | None:
    if not user_id:
        return None
    return db.execute(select(user_table.c.name).where(user_table.c.id == user_id)).scalar()


def _expire_stale(db: Session, organization_id: str, email: str | None = None) -> None:
    """Pending invitations past their date become 'expired' (lazily), freeing the email for a new one."""
    q = update(Invitation).where(
        Invitation.organization_id == organization_id, Invitation.status == "pending", Invitation.expires_at <= _now()
    )
    if email:
        q = q.where(Invitation.email == email)
    db.execute(q.values(status="expired", updated_at=_now()).execution_options(synchronize_session=False))
    db.expire_all()


def _send(db: Session, inv: Invitation, token: str, org: Organization, ws: Workspace | None, inviter_id: str) -> None:
    from app.email import render, send

    inviter = _inviter_name(db, inviter_id) or "A teammate"
    where = f"{ws.name} in {org.name}" if ws and ws.name != org.name else org.name
    url = _accept_url(token)
    days = get_settings().invite_ttl_days
    subject = f"{inviter} invited you to {org.name} on Vyuham"
    text = (
        f"{inviter} invited you to join {where} on Vyuham as {ROLE_WORDS.get(inv.role, inv.role)}.\n"
        f"The link is for {inv.email} only and expires in {days} days."
    )
    send(inv.email, subject, render(subject, [text], ("Accept invitation", url)), f"{text}\n\n{url}")
    inv.last_sent_at = _now()
    inv.send_count = (inv.send_count or 0) + 1


# ---------- sending ----------


class InvitationsIn(BaseModel):
    emails: list[str] = Field(min_length=1, max_length=20)
    role: InviteRole = "analyst"
    workspace_id: str | None = None  # defaults to the current workspace


class InvitationOut(BaseModel):
    id: str
    email: str
    role: str
    status: str
    workspace_id: str | None
    workspace_name: str | None = None
    invited_by: str | None = None
    invited_by_name: str | None = None
    expires_at: UtcDatetime
    created_at: UtcDatetime
    last_sent_at: UtcDatetime | None = None
    send_count: int = 0


class InviteResult(BaseModel):
    email: str
    result: Literal["invited", "already_member", "already_invited", "invalid"]
    message: str | None = None
    invitation: InvitationOut | None = None
    # Shown once, so it can be copied and shared when email isn't configured. Only works for `email`.
    accept_url: str | None = None


def _out(db: Session, inv: Invitation, ws_names: dict[str, str] | None = None) -> InvitationOut:
    status_ = inv.status
    if status_ == "pending" and _aware(inv.expires_at) <= _now():
        status_ = "expired"
    ws_name = (ws_names or {}).get(inv.workspace_id or "")
    if ws_name is None and inv.workspace_id:
        ws = db.get(Workspace, inv.workspace_id)
        ws_name = ws.name if ws else None
    return InvitationOut(
        id=inv.id, email=inv.email, role=inv.role, status=status_, workspace_id=inv.workspace_id, workspace_name=ws_name,
        invited_by=inv.invited_by, invited_by_name=_inviter_name(db, inv.invited_by), expires_at=inv.expires_at,
        created_at=inv.created_at, last_sent_at=inv.last_sent_at, send_count=inv.send_count or 0,
    )


def _target_workspace(db: Session, member: WorkspaceMember, workspace_id: str | None) -> Workspace:
    ws_id = workspace_id or member.workspace_id
    ws = tenancy.live_workspace(db, ws_id)
    if ws is None or ws.organization_id != member.organization_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")
    return ws


@router.post("/invitations", response_model=list[InviteResult], status_code=status.HTTP_201_CREATED)
def create_invitations(
    body: InvitationsIn,
    member: WorkspaceMember = Depends(current_membership),
    user: AuthUser = Depends(current_user),
    db: Session = Depends(get_db),
):
    require(member, Perm.MEMBERS_INVITE)
    require_verified_email(user)
    org = _org_of(db, member)
    actor = tenancy.org_membership(db, user.id, org.id)
    if actor is None or rank(body.role) > rank(actor.role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't invite someone with a role above your own.")
    ws = _target_workspace(db, member, body.workspace_id)

    from app.email_check import check_email

    seen: set[str] = set()
    results: list[InviteResult] = []
    to_create: list[str] = []
    for raw in body.emails:
        email = raw.strip().lower()
        if not email or email in seen:
            continue
        seen.add(email)
        if len(email) > 320 or not re.match(EMAIL, email):
            results.append(InviteResult(email=email, result="invalid", message="That doesn't look like an email address."))
            continue
        existing_user = db.execute(select(user_table.c.id).where(func.lower(user_table.c.email) == email)).scalar()
        if existing_user and tenancy.org_membership(db, existing_user, org.id):
            results.append(InviteResult(email=email, result="already_member", message="Already in your organization."))
            continue
        if check_email(email) == "invalid":
            results.append(InviteResult(email=email, result="invalid", message="This address can't receive email. Check it for typos."))
            continue
        to_create.append(email)

    if to_create:
        _expire_stale(db, org.id)
        pending = set(db.scalars(select(Invitation.email).where(
            Invitation.organization_id == org.id, Invitation.status == "pending", Invitation.email.in_(to_create)
        )))
        fresh = [e for e in to_create if e not in pending]
        for e in to_create:
            if e in pending:
                results.append(InviteResult(email=e, result="already_invited", message="Already invited. Use Resend from the invitations list."))
        plans.check_seats(db, org, len(fresh))
        for email in fresh:
            token, digest = _new_token()
            inv = Invitation(
                organization_id=org.id, workspace_id=ws.id, email=email, role=body.role, token_hash=digest,
                status="pending", expires_at=_now() + _ttl(), invited_by=user.id,
            )
            try:
                with db.begin_nested():
                    db.add(inv)
            except IntegrityError:  # someone invited the same address a moment ago
                results.append(InviteResult(email=email, result="already_invited", message="Already invited."))
                continue
            record_org_action(db, org.id, user.id, "invite.create", "invitation", inv.id, {"role": body.role, "workspace_id": ws.id}, workspace_id=ws.id)
            _send(db, inv, token, org, ws, user.id)
            results.append(InviteResult(email=email, result="invited", invitation=_out(db, inv), accept_url=_accept_url(token)))
        db.commit()
    return results


@router.get("/invitations", response_model=list[InvitationOut])
def list_invitations(
    include_closed: bool = False, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db),
):
    require(member, Perm.MEMBERS_INVITE)
    org = _org_of(db, member)
    q = select(Invitation).where(Invitation.organization_id == org.id)
    if not include_closed:
        q = q.where(Invitation.status == "pending")
    rows = db.scalars(q.order_by(Invitation.created_at.desc()).limit(500)).all()
    ws_names = dict(db.execute(select(Workspace.id, Workspace.name).where(Workspace.organization_id == org.id)).all())
    return [_out(db, i, ws_names) for i in rows]


def _owned_invitation(db: Session, member: WorkspaceMember, invitation_id: str) -> Invitation:
    inv = db.get(Invitation, invitation_id)
    if inv is None or inv.organization_id != member.organization_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found")
    return inv


@router.post("/invitations/{invitation_id}/resend", response_model=InviteResult)
def resend_invitation(
    invitation_id: str,
    member: WorkspaceMember = Depends(current_membership),
    user: AuthUser = Depends(current_user),
    db: Session = Depends(get_db),
):
    require(member, Perm.MEMBERS_INVITE)
    require_verified_email(user)
    inv = _owned_invitation(db, member, invitation_id)
    actor = tenancy.org_membership(db, user.id, inv.organization_id)
    if actor is None or rank(inv.role) > rank(actor.role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't resend an invitation with a role above your own.")
    if inv.status not in ("pending", "expired"):
        raise HTTPException(status.HTTP_409_CONFLICT, f"This invitation was {inv.status}. Send a new one instead.")
    if inv.last_sent_at and _now() - _aware(inv.last_sent_at) < RESEND_COOLDOWN:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "It was just sent. Wait a minute before sending it again.")
    org = _org_of(db, member)
    token, digest = _new_token()  # the old link stops working
    inv.token_hash, inv.status, inv.expires_at = digest, "pending", _now() + _ttl()
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "There's already an open invitation for this address.") from None
    ws = db.get(Workspace, inv.workspace_id) if inv.workspace_id else None
    _send(db, inv, token, org, ws, user.id)
    record_org_action(db, org.id, user.id, "invite.resend", "invitation", inv.id, workspace_id=inv.workspace_id)
    db.commit()
    return InviteResult(email=inv.email, result="invited", invitation=_out(db, inv), accept_url=_accept_url(token))


@router.delete("/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invitation(
    invitation_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db),
):
    require(member, Perm.MEMBERS_INVITE)
    inv = _owned_invitation(db, member, invitation_id)
    if inv.status == "pending":
        inv.status, inv.revoked_at, inv.revoked_by = "revoked", _now(), member.user_id
        record_org_action(db, inv.organization_id, member.user_id, "invite.revoke", "invitation", inv.id, {"email_domain": inv.email.rsplit("@", 1)[-1]}, workspace_id=inv.workspace_id)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- the invited person ----------


class InvitationLookup(BaseModel):
    valid: bool
    reason: str | None = None
    code: Literal["ok", "not_found", "expired", "revoked", "used"] = "ok"
    organization_name: str | None = None
    workspace_name: str | None = None
    role: str | None = None
    invited_by: str | None = None
    email_hint: str | None = None  # "as***@acme.co": enough to know which account to use, not the whole address


def _mask(email: str) -> str:
    local, _, domain = email.partition("@")
    return f"{local[:2]}{'*' * max(1, len(local) - 2)}@{domain}"


def _problem(inv: Invitation | None) -> tuple[str, str] | None:
    if inv is None:
        return "not_found", "This invitation link isn't valid. Ask for a new one."
    if inv.status == "accepted":
        return "used", "This invitation has already been used."
    if inv.status == "revoked":
        return "revoked", "This invitation was withdrawn. Ask for a new one."
    if inv.status == "expired" or _aware(inv.expires_at) <= _now():
        return "expired", "This invitation has expired. Ask for a new one."
    return None


def _find(db: Session, token: str) -> Invitation | None:
    if not token or len(token) > 128:
        return None
    return db.scalar(select(Invitation).where(Invitation.token_hash == token_hash(token)))


@router.get("/invitations/lookup/{token}", response_model=InvitationLookup)
def lookup_invitation(token: str, db: Session = Depends(get_db)):
    """Public: what the link is for, shown before signing up or in. Reveals only the masked address."""
    inv = _find(db, token)
    problem = _problem(inv)
    org = db.get(Organization, inv.organization_id) if inv else None
    if inv is not None and (org is None or org.deleted_at is not None):
        problem = ("not_found", "This organization no longer exists.")
    if problem:
        return InvitationLookup(valid=False, code=problem[0], reason=problem[1])
    ws = db.get(Workspace, inv.workspace_id) if inv.workspace_id else None
    return InvitationLookup(
        valid=True, organization_name=org.name, workspace_name=ws.name if ws else None, role=inv.role,
        invited_by=_inviter_name(db, inv.invited_by), email_hint=_mask(inv.email),
    )


class AcceptIn(BaseModel):
    token: str = Field(min_length=10, max_length=128)


class AcceptOut(BaseModel):
    organization_id: str
    workspace_id: str
    role: str


@router.post("/invitations/accept", response_model=AcceptOut)
def accept_invitation(body: AcceptIn, user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    inv = _find(db, body.token)
    problem = _problem(inv)
    if problem:
        raise HTTPException(status.HTTP_410_GONE, {"code": problem[0], "message": problem[1]})
    if inv.email != user.email.strip().lower():
        # Same message whatever the reason, and no hint of the invited address beyond the masked one.
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {"code": "wrong_email", "message": f"This invitation is for {_mask(inv.email)}. Sign in with that address to accept it."},
        )
    try:
        require_verified_email(user)
    except HTTPException:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {"code": "email_unverified", "message": "Confirm your email address first. We sent you a link when you signed up."},
        ) from None
    org = db.get(Organization, inv.organization_id)
    if org is None or org.deleted_at is not None:
        raise HTTPException(status.HTTP_410_GONE, {"code": "not_found", "message": "This organization no longer exists."})
    ws = tenancy.live_workspace(db, inv.workspace_id) if inv.workspace_id else None
    if ws is None or ws.organization_id != org.id:
        ws = db.scalar(
            select(Workspace).where(Workspace.organization_id == org.id, Workspace.deleted_at.is_(None))
            .order_by(Workspace.is_default.desc(), Workspace.created_at)
        )
    if ws is None:
        raise HTTPException(status.HTTP_410_GONE, {"code": "not_found", "message": "This workspace no longer exists."})

    # Atomic, so two tabs (or two people with a leaked link) can't both use it.
    claimed = db.execute(
        update(Invitation)
        .where(Invitation.id == inv.id, Invitation.status == "pending", Invitation.expires_at > _now())
        .values(status="accepted", accepted_by=user.id, accepted_at=_now(), updated_at=_now())
        .execution_options(synchronize_session=False)
    ).rowcount
    if claimed != 1:
        db.rollback()
        raise HTTPException(status.HTTP_410_GONE, {"code": "used", "message": "This invitation has already been used."})

    om = db.get(OrganizationMember, (org.id, user.id))
    if om is None:
        om = OrganizationMember(organization_id=org.id, user_id=user.id, role=inv.role, status="active")
        db.add(om)
        db.flush()
        tenancy.sync_full_access(db, org.id, user.id, inv.role)
    elif om.status != "active":
        om.status, om.removed_at, om.joined_at = "active", None, _now()
        tenancy.set_org_role(db, om, inv.role)
    elif rank(inv.role) > rank(om.role):
        tenancy.set_org_role(db, om, inv.role)  # an invite to a higher role, sent by someone allowed to
    # Otherwise they keep the role they have: accepting never lowers it.

    db.flush()  # the session doesn't autoflush: make rows added above visible to the lookups below
    wm = db.get(WorkspaceMember, (ws.id, user.id))
    ws_role = om.role if om.role in FULL_ACCESS else inv.role
    if wm is None:
        db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role=ws_role))
    elif rank(ws_role) > rank(wm.role):
        wm.role = ws_role
    record_org_action(db, org.id, user.id, "invite.accept", "invitation", inv.id, {"role": inv.role}, workspace_id=ws.id)
    db.commit()
    tenancy.remember(db, user.id, ws.id)
    return AcceptOut(organization_id=org.id, workspace_id=ws.id, role=tenancy.effective_role(db, user.id, ws.id) or inv.role)
