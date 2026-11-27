from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app import tenancy
from app.db import get_db
from app.models import Organization, UserProfile
from app.permissions import permissions_for
from app.routers.onboarding import needs_onboarding
from app.routers.organizations import workspace_list
from app.schemas import OrganizationRef, UserOut, WorkspaceOut
from app.security import AuthUser, current_user, is_staff

router = APIRouter(tags=["me"])


@router.get("/me", response_model=UserOut)
def me(request: Request, user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    """Who is signed in, the workspace they're acting in, their role and what it allows.

    Works before onboarding too (workspace is then null and needs_onboarding true), so the web app
    can send people to set up their organization instead of showing an error.
    """
    profile = db.get(UserProfile, user.id)
    base = dict(
        id=user.id, email=user.email, name=user.name, job_role=profile.job_role if profile else None,
        email_verified=user.email_verified, is_staff=is_staff(user),
    )
    try:
        try:
            member = tenancy.resolve(db, user.id, request.headers.get(tenancy.WORKSPACE_HEADER))
        except tenancy.OnboardingRequired:
            raise
        except HTTPException:  # a stale or forged X-Workspace-Id: fall back to the saved choice
            member = tenancy.resolve(db, user.id)
    except tenancy.OnboardingRequired:
        return UserOut(**base, role=None, workspace=None, needs_onboarding=True)
    ws = member.workspace
    org = db.get(Organization, ws.organization_id)
    om = tenancy.org_membership(db, user.id, ws.organization_id)
    return UserOut(
        **base,
        role=member.role,
        org_role=om.role if om else None,
        permissions=sorted(p.value for p in permissions_for(member.role, ws.preferences)),
        workspace=WorkspaceOut.model_validate(ws),
        organization=OrganizationRef(id=org.id, name=org.name, plan=org.plan) if org else None,
        workspaces=[w.model_dump() for w in workspace_list(db, user.id, ws.id)],
        needs_onboarding=needs_onboarding(db, user.id),
    )
