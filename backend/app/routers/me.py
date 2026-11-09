from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import UserProfile, WorkspaceMember
from app.schemas import UserOut, WorkspaceOut
from app.security import AuthUser, current_membership, current_user

router = APIRouter(tags=["me"])


@router.get("/me", response_model=UserOut)
def me(
    user: AuthUser = Depends(current_user),
    member: WorkspaceMember = Depends(current_membership),
    db: Session = Depends(get_db),
):
    profile = db.get(UserProfile, user.id)
    return UserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        role=member.role,
        job_role=profile.job_role if profile else None,
        workspace=WorkspaceOut.model_validate(member.workspace),
    )
