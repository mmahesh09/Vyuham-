"""Refresh hooks: secret URLs a customer's pipeline calls to refresh connected datasets.

Airflow (an HTTP task at the end of a DAG), Airbyte (its "sync succeeded" webhook), Kubeflow (a final
`curl` step) and cron all work the same way: they POST to `/hooks/refresh/<token>`.

The public endpoint always answers 202 with the same body, whether the token is right, wrong or revoked,
so the response can't be used to probe for tokens. Only a SHA-256 of each token is stored.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.audit import record_action
from app.db import get_db
from app.models import AuditLog, Dataset, RefreshHook, WorkspaceMember
from app.routers.datasets import queue_sync, require_editor
from app.schemas import RefreshHookCreatedOut, RefreshHookIn, RefreshHookOut
from app.security import current_membership

log = logging.getLogger("app.hooks")

router = APIRouter(prefix="/refresh-hooks", tags=["refresh hooks"])
public = APIRouter(prefix="/hooks", tags=["refresh hooks"])

MAX_HOOKS = 20
TOKEN_PREFIX = "vyh_"
ACCEPTED = {"accepted": True}


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _connected_ids(db: Session, workspace_id: str, ids: list[str]) -> set[str]:
    """The given dataset ids that exist in this workspace and come from a connected database."""
    return set(db.scalars(
        select(Dataset.id).where(Dataset.workspace_id == workspace_id, Dataset.id.in_(ids), Dataset.connection_id.is_not(None))
    ))


# ---------- managing hooks (signed in, editors) ----------


@router.get("", response_model=list[RefreshHookOut])
def list_hooks(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return db.scalars(
        select(RefreshHook).where(RefreshHook.workspace_id == member.workspace_id).order_by(RefreshHook.created_at.desc())
    ).all()


@router.post("", response_model=RefreshHookCreatedOut, status_code=status.HTTP_201_CREATED)
def create_hook(body: RefreshHookIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    active = db.scalar(select(func.count()).select_from(RefreshHook).where(
        RefreshHook.workspace_id == member.workspace_id, RefreshHook.revoked_at.is_(None)
    ))
    if active >= MAX_HOOKS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"A workspace can have up to {MAX_HOOKS} active refresh hooks. Revoke one you no longer use.")
    ids = list(dict.fromkeys(body.dataset_ids))
    if _connected_ids(db, member.workspace_id, ids) != set(ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A refresh hook can only refresh data from a connected database in this workspace.")
    token = TOKEN_PREFIX + secrets.token_urlsafe(32)
    hook = RefreshHook(
        workspace_id=member.workspace_id, name=body.name, dataset_ids=ids,
        token_hash=_hash(token), token_hint=token[-4:], created_by=member.user_id,
    )
    db.add(hook)
    db.flush()
    record_action(db, member, "refresh_hook.create", "refresh_hook", hook.id, {"datasets": len(ids)})
    db.commit()
    return RefreshHookCreatedOut(**RefreshHookOut.model_validate(hook).model_dump(), path=f"/hooks/refresh/{token}")


@router.delete("/{hook_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_hook(hook_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    hook = db.get(RefreshHook, hook_id)
    if hook is None or hook.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Refresh hook not found")
    if hook.revoked_at is None:
        hook.revoked_at = datetime.now(timezone.utc)
        record_action(db, member, "refresh_hook.revoke", "refresh_hook", hook.id)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- the URL pipelines call (no sign-in) ----------


async def _requested_ids(request: Request) -> set[str] | None:
    """Optional `{"dataset_ids": [...]}` to refresh only some of the hook's datasets. Any other body is ignored,
    so tools that send their own payload (Airbyte's webhook, for one) work unchanged."""
    try:
        body = await request.json()
    except Exception:
        return None
    ids = body.get("dataset_ids") if isinstance(body, dict) else None
    if not isinstance(ids, list):
        return None
    return {i for i in ids if isinstance(i, str)}


@public.post("/refresh/{token}", status_code=status.HTTP_202_ACCEPTED)
async def call_hook(token: str, request: Request, background: BackgroundTasks, db: Session = Depends(get_db)):
    requested = await _requested_ids(request)
    await run_in_threadpool(_refresh, db, token, requested, background)  # database work stays off the event loop
    return ACCEPTED


def _refresh(db: Session, token: str, requested: set[str] | None, background: BackgroundTasks) -> None:
    hook = db.scalar(select(RefreshHook).where(RefreshHook.token_hash == _hash(token))) if token.startswith(TOKEN_PREFIX) else None
    if hook is None or hook.revoked_at is not None:
        return
    wanted = [i for i in hook.dataset_ids if requested is None or i in requested]
    datasets = db.scalars(select(Dataset).where(
        Dataset.workspace_id == hook.workspace_id, Dataset.id.in_(wanted), Dataset.connection_id.is_not(None)
    )).all()
    queued = sum(queue_sync(db, ds, background) for ds in datasets)
    hook.last_called_at = datetime.now(timezone.utc)
    db.add(AuditLog(
        workspace_id=hook.workspace_id, user_id=None, action="refresh_hook.call", target_type="refresh_hook",
        target_id=hook.id, detail={"datasets": len(datasets), "queued": queued},
    ))
    db.commit()
