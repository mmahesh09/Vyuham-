"""Similarity search over knowledge, with retrieval permissions enforced in one place.

A customer can only ever retrieve:
  * global articles that are approved (staff-tested), and
  * their own workspace's private articles that are approved.
Pending, rejected and archived articles, and every other workspace's articles, are excluded in the
SQL itself, before ranking. `visible_articles()` is the only way articles are read for customers.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from sqlalchemy import Float, and_, or_, select, text
from sqlalchemy.orm import Session
from sqlalchemy.sql import Select

from app.config import get_settings
from app.support_ai.embeddings import embed, model_name
from app.support_ai.models import KnowledgeArticle, KnowledgeEmbedding


def visibility_clause(workspace_id: str):
    """SQL condition: approved, and either global or this workspace's own."""
    if not workspace_id:
        raise ValueError("workspace_id is required for retrieval")
    return and_(
        KnowledgeArticle.status == "approved",
        or_(
            and_(KnowledgeArticle.scope == "global", KnowledgeArticle.workspace_id.is_(None)),
            and_(KnowledgeArticle.scope == "tenant", KnowledgeArticle.workspace_id == workspace_id),
        ),
    )


def visible_articles(workspace_id: str) -> Select:
    return select(KnowledgeArticle).where(visibility_clause(workspace_id))


def get_visible_article(db: Session, workspace_id: str, article_id: str) -> KnowledgeArticle | None:
    return db.scalar(visible_articles(workspace_id).where(KnowledgeArticle.id == article_id))


@dataclass
class Hit:
    article: KnowledgeArticle
    score: float  # cosine similarity, or 1.0 for an exact fingerprint match
    exact: bool


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


def search(db: Session, workspace_id: str, query: str, fingerprint: str | None = None, limit: int | None = None) -> list[Hit]:
    """Top articles for a redacted query. Exact fingerprint matches first, then nearest neighbours."""
    s = get_settings()
    limit = limit or s.support_ai_max_articles
    hits: dict[str, Hit] = {}

    if fingerprint:
        for a in db.scalars(visible_articles(workspace_id)):
            if fingerprint in (a.fingerprints or []):
                hits[a.id] = Hit(a, 1.0, True)

    model = model_name()
    qvec = embed([query], "query")[0]
    if db.bind.dialect.name == "postgresql":
        # pgvector: cosine distance, filtered by visibility and model in the same query.
        distance = KnowledgeEmbedding.embedding.op("<=>", return_type=Float)(text("CAST(:qvec AS vector)"))
        stmt = (
            select(KnowledgeArticle, (1 - distance).label("score"))
            .join(KnowledgeEmbedding, KnowledgeEmbedding.article_id == KnowledgeArticle.id)
            .where(visibility_clause(workspace_id), KnowledgeEmbedding.model == model)
            .order_by(distance)
            .limit(limit * 2)
        )
        rows = db.execute(stmt, {"qvec": "[" + ",".join(f"{x:.7g}" for x in qvec) + "]"}).all()
        scored = [(a, float(score)) for a, score in rows]
    else:
        stmt = (
            select(KnowledgeArticle, KnowledgeEmbedding.embedding)
            .join(KnowledgeEmbedding, KnowledgeEmbedding.article_id == KnowledgeArticle.id)
            .where(visibility_clause(workspace_id), KnowledgeEmbedding.model == model)
        )
        scored = sorted(((a, _cosine(qvec, vec)) for a, vec in db.execute(stmt).all()), key=lambda r: r[1], reverse=True)

    for a, score in scored:
        if score >= s.support_ai_min_similarity and a.id not in hits:
            hits[a.id] = Hit(a, score, False)
    return sorted(hits.values(), key=lambda h: (not h.exact, -h.score))[:limit]
