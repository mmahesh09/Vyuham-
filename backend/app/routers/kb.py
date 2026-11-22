"""The help center: published articles are public (no sign-in); staff write and publish them."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.db import get_db
from app.kb_search import search
from app.models import ErrorGroup, KbArticle, KbDeflection, SupportTicket
from app.routers.support import unique_slug
from app.security import AuthUser, current_user, require_staff
from app.support_schemas import ArticleIn, ArticleOut, ArticleSummary, DeflectionIn, FeedbackIn, StaffArticleOut

router = APIRouter(prefix="/kb", tags=["kb"])


def _published(db: Session, slug: str) -> KbArticle:
    a = db.scalar(select(KbArticle).where(KbArticle.slug == slug, KbArticle.status == "published"))
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Article not found")
    return a


@router.get("", response_model=list[ArticleSummary])
def list_articles(tag: str | None = Query(default=None, max_length=40), db: Session = Depends(get_db)):
    rows = db.scalars(select(KbArticle).where(KbArticle.status == "published").order_by(KbArticle.title)).all()
    if tag:
        rows = [a for a in rows if tag.lower() in (a.tags or [])]
    return [ArticleSummary.model_validate(a) for a in rows]


@router.get("/popular", response_model=list[ArticleSummary])
def popular_articles(limit: int = Query(default=6, ge=1, le=20), db: Session = Depends(get_db)):
    """Published articles people actually found useful: "yes, this helped" votes plus opens from the
    new-request form. Articles nobody has used yet are left out, so an empty list means "no usage data"."""
    deflections = (
        select(KbDeflection.article_id, func.count().label("n")).group_by(KbDeflection.article_id).subquery()
    )
    score = (KbArticle.helpful_yes + func.coalesce(deflections.c.n, 0)).label("score")
    rows = db.execute(
        select(KbArticle, score)
        .outerjoin(deflections, deflections.c.article_id == KbArticle.id)
        .where(KbArticle.status == "published")
        .order_by(score.desc(), KbArticle.updated_at.desc())
        .limit(limit)
    ).all()
    return [ArticleSummary.model_validate(a) for a, n in rows if n > 0]


@router.get("/search", response_model=list[ArticleSummary])
def search_articles(q: str = Query(min_length=2, max_length=200), limit: int = Query(default=5, ge=1, le=20), db: Session = Depends(get_db)):
    return [ArticleSummary.model_validate(a) for a in search(db, q, limit=limit)]


@router.get("/articles/{slug}", response_model=ArticleOut)
def get_article(slug: str, db: Session = Depends(get_db)):
    a = _published(db, slug)
    db.execute(update(KbArticle).where(KbArticle.id == a.id).values(views=KbArticle.views + 1))
    db.commit()
    return ArticleOut.model_validate(a)


@router.post("/articles/{slug}/feedback", status_code=status.HTTP_204_NO_CONTENT)
def feedback(slug: str, body: FeedbackIn, db: Session = Depends(get_db)):
    a = _published(db, slug)
    col = KbArticle.helpful_yes if body.helpful else KbArticle.helpful_no
    db.execute(update(KbArticle).where(KbArticle.id == a.id).values({col: col + 1}))
    db.commit()


@router.post("/deflections", status_code=status.HTTP_204_NO_CONTENT)
def deflection(body: DeflectionIn, user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    """The new-ticket form opened a suggested article: counted in the support metrics."""
    if db.get(KbArticle, body.article_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Article not found")
    db.add(KbDeflection(article_id=body.article_id, user_id=user.id))
    db.commit()


# --- Staff -------------------------------------------------------------------------------------

admin = APIRouter(prefix="/kb/admin", tags=["kb-admin"], dependencies=[Depends(require_staff)])


def _article(db: Session, article_id: str) -> KbArticle:
    a = db.get(KbArticle, article_id)
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Article not found")
    return a


@admin.get("/articles", response_model=list[StaffArticleOut])
def staff_list(db: Session = Depends(get_db)):
    return [StaffArticleOut.model_validate(a) for a in db.scalars(select(KbArticle).order_by(KbArticle.updated_at.desc()))]


@admin.get("/articles/{article_id}", response_model=StaffArticleOut)
def staff_get(article_id: str, db: Session = Depends(get_db)):
    return StaffArticleOut.model_validate(_article(db, article_id))


def _apply(db: Session, a: KbArticle, body: ArticleIn) -> None:
    a.title, a.summary, a.body, a.tags = body.title, body.summary, body.body, body.tags
    if body.slug:
        if (owner := db.scalar(select(KbArticle.id).where(KbArticle.slug == body.slug))) and owner != a.id:
            raise HTTPException(status.HTTP_409_CONFLICT, "Another article already uses that address")
        a.slug = body.slug
    elif not a.slug:
        a.slug = unique_slug(db, body.title)
    if body.status == "published" and a.status != "published":
        a.published_at = datetime.now(timezone.utc)
    a.status = body.status


@admin.post("/articles", response_model=StaffArticleOut, status_code=status.HTTP_201_CREATED)
def staff_create(body: ArticleIn, staff: AuthUser = Depends(require_staff), db: Session = Depends(get_db)):
    a = KbArticle(slug="", created_by=staff.id)
    _apply(db, a, body)
    db.add(a)
    db.commit()
    db.refresh(a)
    return StaffArticleOut.model_validate(a)


@admin.put("/articles/{article_id}", response_model=StaffArticleOut)
def staff_update(article_id: str, body: ArticleIn, db: Session = Depends(get_db)):
    a = _article(db, article_id)
    _apply(db, a, body)
    db.commit()
    db.refresh(a)
    return StaffArticleOut.model_validate(a)


@admin.delete("/articles/{article_id}", status_code=status.HTTP_204_NO_CONTENT)
def staff_delete(article_id: str, db: Session = Depends(get_db)):
    a = _article(db, article_id)
    db.execute(update(ErrorGroup).where(ErrorGroup.kb_article_id == a.id).values(kb_article_id=None))
    db.execute(update(SupportTicket).where(SupportTicket.kb_article_id == a.id).values(kb_article_id=None))
    db.delete(a)
    db.commit()

