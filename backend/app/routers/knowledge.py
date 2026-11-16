"""Knowledge review for Vyuham support staff and administrators (see support_ai/access.py).

Customers can't call any of these (404). Approval rules, the admin-only rules for global articles and
the audit log live in support_ai/approval.py, so they hold whichever route calls them.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Workspace
from app.support_ai import approval
from app.support_ai.access import Actor, require_support_staff
from app.support_ai.models import KnowledgeArticle

router = APIRouter(prefix="/support/knowledge", tags=["knowledge"])


class ArticleFields(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=200)
    symptoms: str | None = Field(default=None, min_length=3, max_length=4000)
    root_cause: str | None = Field(default=None, min_length=3, max_length=4000)
    resolution: str | None = Field(default=None, min_length=3, max_length=6000)
    modules: list[str] | None = Field(default=None, max_length=8)
    categories: list[str] | None = Field(default=None, max_length=20)
    fingerprints: list[str] | None = Field(default=None, max_length=20)


class ArticleIn(ArticleFields):
    scope: Literal["global", "tenant"]
    workspace_id: str | None = Field(default=None, max_length=32)
    title: str = Field(min_length=3, max_length=200)
    symptoms: str = Field(min_length=3, max_length=4000)
    root_cause: str = Field(min_length=3, max_length=4000)
    resolution: str = Field(min_length=3, max_length=6000)


def _out(a: KnowledgeArticle) -> dict:
    return {c: getattr(a, c) for c in ("id", "scope", "workspace_id", "title", "symptoms", "root_cause", "resolution", "modules", "categories", "fingerprints", "status", "tested", "test_notes", "source", "source_ref", "helpful_count", "unhelpful_count", "reviewed_by", "review_note")} | {
        "reviewed_at": a.reviewed_at.isoformat() if a.reviewed_at else None,
        "created_at": a.created_at.isoformat(),
    }


def _get(db: Session, article_id: str) -> KnowledgeArticle:
    a = db.get(KnowledgeArticle, article_id)
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Article not found")
    return a


def _run(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except approval.ApprovalError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from None
    except approval.NotAllowed as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(e)) from None


@router.get("")
def list_articles(
    status_: Literal["pending", "approved", "rejected", "archived"] | None = Query(default="pending", alias="status"),
    scope: Literal["global", "tenant"] | None = None,
    _: Actor = Depends(require_support_staff),
    db: Session = Depends(get_db),
):
    stmt = select(KnowledgeArticle).order_by(KnowledgeArticle.created_at.desc()).limit(200)
    if status_:
        stmt = stmt.where(KnowledgeArticle.status == status_)
    if scope:
        stmt = stmt.where(KnowledgeArticle.scope == scope)
    rows = db.scalars(stmt).all()
    names = dict(db.execute(select(Workspace.id, Workspace.name).where(Workspace.id.in_({a.workspace_id for a in rows if a.workspace_id}))).all()) if rows else {}
    return {"articles": [{**_out(a), "workspace": names.get(a.workspace_id)} for a in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
def create(body: ArticleIn, staff: Actor = Depends(require_support_staff), db: Session = Depends(get_db)):
    if body.workspace_id and db.get(Workspace, body.workspace_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown workspace")
    fields = body.model_dump(exclude={"scope", "workspace_id"}, exclude_none=True)
    return _out(_run(approval.create_article, db, staff, scope=body.scope, workspace_id=body.workspace_id, **fields))


@router.get("/{article_id}")
def get(article_id: str, _: Actor = Depends(require_support_staff), db: Session = Depends(get_db)):
    return _out(_get(db, article_id))


@router.patch("/{article_id}")
def edit(article_id: str, body: ArticleFields, staff: Actor = Depends(require_support_staff), db: Session = Depends(get_db)):
    return _out(_run(approval.edit_article, db, staff, _get(db, article_id), **body.model_dump(exclude_none=True)))


class ApproveIn(BaseModel):
    tested: bool
    test_notes: str = Field(min_length=10, max_length=2000)
    confirm_no_customer_data: bool = False


@router.post("/{article_id}/approve")
def approve(article_id: str, body: ApproveIn, staff: Actor = Depends(require_support_staff), db: Session = Depends(get_db)):
    return _out(_run(approval.approve, db, staff, _get(db, article_id), tested=body.tested, test_notes=body.test_notes, confirm_no_customer_data=body.confirm_no_customer_data))


class RejectIn(BaseModel):
    note: str = Field(min_length=3, max_length=1000)


@router.post("/{article_id}/reject")
def reject(article_id: str, body: RejectIn, staff: Actor = Depends(require_support_staff), db: Session = Depends(get_db)):
    return _out(_run(approval.reject, db, staff, _get(db, article_id), body.note))


@router.post("/{article_id}/archive")
def archive(article_id: str, staff: Actor = Depends(require_support_staff), db: Session = Depends(get_db)):
    return _out(_run(approval.archive, db, staff, _get(db, article_id)))


class PromoteIn(ArticleFields):
    title: str = Field(min_length=3, max_length=200)
    symptoms: str = Field(min_length=3, max_length=4000)
    root_cause: str = Field(min_length=3, max_length=4000)
    resolution: str = Field(min_length=3, max_length=6000)


@router.post("/{article_id}/promote", status_code=status.HTTP_201_CREATED)
def promote(article_id: str, body: PromoteIn, staff: Actor = Depends(require_support_staff), db: Session = Depends(get_db)):
    """Write a new, generalized global article based on a workspace one. It starts pending."""
    return _out(_run(approval.promote, db, staff, _get(db, article_id), **body.model_dump(exclude_none=True)))
