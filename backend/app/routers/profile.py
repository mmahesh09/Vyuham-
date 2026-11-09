"""Profile, team and activity endpoints behind /profile in the app."""

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth_tables import user_table
from app.db import get_db
from app.models import Dataset, Feedback, LeaveRecord, Task, UserPresence, UserProfile, WorkspaceMember
from app.routers.presence import refresh_presence
from app.schemas import ActivityOut, FeedbackIn, MemberOut, ProfileIn, ProfileOut
from app.security import AuthUser, current_membership, current_user

router = APIRouter(tags=["profile"])


@router.get("/me/profile", response_model=ProfileOut)
def get_profile(user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    profile = db.get(UserProfile, user.id)
    return ProfileOut.model_validate(profile) if profile else ProfileOut()


@router.put("/me/profile", response_model=ProfileOut)
def save_profile(body: ProfileIn, user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    profile = db.get(UserProfile, user.id) or UserProfile(user_id=user.id)
    for key, value in body.model_dump().items():
        setattr(profile, key, value)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return ProfileOut.model_validate(profile)


@router.get("/workspace/members", response_model=list[MemberOut])
def members(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    rows = db.execute(
        select(
            user_table.c.id, user_table.c.name, user_table.c.email,
            WorkspaceMember.role, WorkspaceMember.created_at, UserProfile.job_role,
        )
        .join(WorkspaceMember, WorkspaceMember.user_id == user_table.c.id)
        .outerjoin(UserProfile, UserProfile.user_id == user_table.c.id)
        .where(WorkspaceMember.workspace_id == member.workspace_id)
        .order_by(WorkspaceMember.created_at)
    ).all()
    names = {r.id: r.name for r in rows}
    out = []
    for r in rows:
        p = refresh_presence(db, db.get(UserPresence, r.id))
        leave = p.leave if p and p.status == "on_leave" else None
        out.append(MemberOut(
            id=r.id, name=r.name, email=r.email, role=r.role, job_role=r.job_role, joined_at=r.created_at,
            # "Appear offline" is shown to others as plain offline.
            status=("offline" if p and p.status == "appear_offline" and r.id != member.user_id
                    else p.status if p else "available"),
            status_message=p.message if p else None,
            leave_type=leave.leave_type if leave else None,
            leave_until=leave.end_date if leave else None,
            backup_name=(names.get(leave.backup_user_id or "") or leave.backup_name) if leave else None,
        ))
    return out


@router.get("/workspace/activity", response_model=list[ActivityOut])
def activity(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Recent changes in the workspace, newest first: uploads, people joining, profile updates."""
    ws = member.workspace_id
    names = dict(
        db.execute(
            select(user_table.c.id, user_table.c.name)
            .join(WorkspaceMember, WorkspaceMember.user_id == user_table.c.id)
            .where(WorkspaceMember.workspace_id == ws)
        ).all()
    )
    items: list[ActivityOut] = []
    for d in db.scalars(select(Dataset).where(Dataset.workspace_id == ws).order_by(Dataset.created_at.desc()).limit(20)):
        items.append(ActivityOut(
            id=f"dataset-{d.id}", kind="dataset", title=f"Uploaded {d.name}",
            detail=f"{d.row_count:,} rows Â· {len(d.columns)} columns", actor=names.get(d.created_by, "Someone"), at=d.created_at,
        ))
    for m in db.scalars(select(WorkspaceMember).where(WorkspaceMember.workspace_id == ws)):
        items.append(ActivityOut(
            id=f"member-{m.user_id}", kind="member", title="Joined the workspace",
            detail=f"as {m.role}", actor=names.get(m.user_id, "Someone"), at=m.created_at,
        ))
    for p in db.scalars(select(UserProfile).where(UserProfile.user_id.in_(names))):
        items.append(ActivityOut(
            id=f"profile-{p.user_id}", kind="profile", title="Updated their profile",
            detail=p.job_role, actor=names[p.user_id], at=p.updated_at,
        ))
    leaves = db.scalars(
        select(LeaveRecord).where(LeaveRecord.workspace_id == ws).order_by(LeaveRecord.created_at.desc()).limit(20)
    )
    for lv in leaves:
        backup = names.get(lv.backup_user_id or "") or lv.backup_name or "someone"
        items.append(ActivityOut(
            id=f"leave-{lv.id}", kind="leave", title=f"Is on {lv.leave_type} leave",
            detail=f"{lv.start_date:%b %d} – {lv.end_date:%b %d} · {backup} is covering",
            actor=names.get(lv.user_id, "Someone"), at=lv.created_at,
        ))
    for t in db.scalars(select(Task).where(Task.workspace_id == ws).order_by(Task.updated_at.desc()).limit(20)):
        assignee = names.get(t.assignee_id or "")
        if t.completed_at:
            items.append(ActivityOut(id=f"task-done-{t.id}", kind="task", title="Completed a task", detail=t.title,
                                     actor=assignee or names.get(t.created_by or "", "Someone"), at=t.completed_at))
        items.append(ActivityOut(id=f"task-{t.id}", kind="task", title="Added a task",
                                 detail=f"{t.title}" + (f" · for {assignee}" if assignee else ""),
                                 actor=names.get(t.created_by or "", "Someone"), at=t.created_at))
    items.sort(key=lambda a: a.at, reverse=True)
    return items[:30]


@router.post("/feedback", status_code=status.HTTP_201_CREATED)
def feedback(body: FeedbackIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    db.add(Feedback(user_id=member.user_id, workspace_id=member.workspace_id, rating=body.rating, comment=body.comment))
    db.commit()
    return {"ok": True}
