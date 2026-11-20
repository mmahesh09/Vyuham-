"""Help-center search: Postgres full-text search in production, a plain LIKE match on SQLite (dev, tests).

Callers get the same thing either way: published articles, best match first.
"""

from __future__ import annotations

import re

from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session

from app.models import KbArticle

WORD = re.compile(r"[a-z0-9]+")
STOP = {"the", "a", "an", "of", "in", "for", "to", "and", "or", "is", "it", "my", "i", "on", "with", "how", "do", "can", "why", "what"}
MAX_TERMS = 8

# The GIN index in the migration is on exactly this expression, so Postgres can use it.
PG_DOC = "to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(body,''))"


def terms(q: str) -> list[str]:
    seen: list[str] = []
    for w in WORD.findall(q.lower()):
        if len(w) > 1 and w not in STOP and w not in seen:
            seen.append(w)
    return seen[:MAX_TERMS]


def search(db: Session, q: str, limit: int = 5, include_drafts: bool = False) -> list[KbArticle]:
    words = terms(q)
    if not words:
        return []
    if db.get_bind().dialect.name == "postgresql":
        return _search_pg(db, words, limit, include_drafts)
    return _search_like(db, words, limit, include_drafts)


def _search_pg(db: Session, words: list[str], limit: int, include_drafts: bool) -> list[KbArticle]:
    # OR the words together so a long, chatty ticket subject still finds the article; rank sorts it out.
    query = " | ".join(words)
    status_clause = "" if include_drafts else "AND status = 'published'"
    # Raw SQL on purpose: PG_DOC must match the indexed expression exactly (see the 8d5f2b3c4e71 migration),
    # and an ORM rewrite would bind 'english' as a parameter, so Postgres could stop using the index. Only
    # constants are formatted in; the search words are the bound :q.
    rows = db.execute(
        text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            f"SELECT id FROM kb_articles WHERE {PG_DOC} @@ to_tsquery('english', :q) {status_clause} "  # nosec B608 - constants only
            f"ORDER BY ts_rank({PG_DOC}, to_tsquery('english', :q)) DESC, updated_at DESC LIMIT :n"
        ),
        {"q": query, "n": limit},
    ).scalars().all()
    if not rows:
        return []
    by_id = {a.id: a for a in db.scalars(select(KbArticle).where(KbArticle.id.in_(rows)))}
    return [by_id[i] for i in rows if i in by_id]


def _escape_like(w: str) -> str:
    return w.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _search_like(db: Session, words: list[str], limit: int, include_drafts: bool) -> list[KbArticle]:
    conds = []
    for w in words:
        pat = f"%{_escape_like(w)}%"
        conds += [KbArticle.title.ilike(pat, escape="\\"), KbArticle.summary.ilike(pat, escape="\\"), KbArticle.body.ilike(pat, escape="\\")]
    stmt = select(KbArticle).where(or_(*conds)).limit(200)
    if not include_drafts:
        stmt = stmt.where(KbArticle.status == "published")
    candidates = db.scalars(stmt).all()

    def score(a: KbArticle) -> int:
        title, summary, body = a.title.lower(), (a.summary or "").lower(), (a.body or "").lower()
        return sum(3 * (w in title) + 2 * (w in summary) + (w in body) for w in words)

    return sorted(candidates, key=lambda a: (-score(a), a.title))[:limit]
