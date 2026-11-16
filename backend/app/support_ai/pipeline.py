"""Background job handlers: embed an article; answer a session (retrieve -> generate -> store)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.support_ai import embeddings, generation, search
from app.support_ai.jobs import RetryableJobError
from app.support_ai.models import SupportAiReference, SupportAiSession, SupportErrorGroup

log = logging.getLogger("app.support_ai.pipeline")
EARLIER_TURNS = 4


def handle_embed_article(db: Session, article_id: str, final_attempt: bool = False) -> None:
    try:
        embeddings.embed_article(db, article_id)
    except embeddings.EmbeddingError as e:
        if e.retryable:
            raise RetryableJobError(str(e)) from None
        raise


def _earlier_turns(db: Session, session: SupportAiSession) -> list[dict]:
    rows = db.scalars(
        select(SupportAiSession)
        .where(
            SupportAiSession.thread_id == session.thread_id,
            SupportAiSession.workspace_id == session.workspace_id,
            SupportAiSession.user_id == session.user_id,
            SupportAiSession.status == "answered",
            SupportAiSession.created_at < session.created_at,
        )
        .order_by(SupportAiSession.created_at.desc())
        .limit(EARLIER_TURNS)
    ).all()
    return [{"question": r.question, "answer_summary": (r.answer or {}).get("summary", "")} for r in reversed(rows)]


def handle_answer_session(db: Session, session_id: str, final_attempt: bool = False) -> None:
    session = db.get(SupportAiSession, session_id)
    if session is None or session.status == "answered":
        return
    session.status = "running"
    db.commit()

    group = db.get(SupportErrorGroup, session.error_group_id) if session.error_group_id else None
    if group is not None and group.workspace_id != session.workspace_id:  # defence in depth
        group = None
    error = {"category": group.category, "type": group.error_type, "message": group.sample_message} if group else None
    query = "\n".join(p for p in [session.question, group.normalized_message if group else "", group.category if group else "", session.module] if p)

    try:
        hits = search.search(db, session.workspace_id, query, fingerprint=group.fingerprint if group else None)
        result = generation.generate(session.question, session.module, error, session.context or None, hits, _earlier_turns(db, session))
    except embeddings.EmbeddingError as e:
        if e.retryable and not final_attempt:
            session.status = "queued"
            db.commit()
            raise RetryableJobError(str(e)) from None
        return _fail(db, session, "Help articles couldn't be searched right now.")
    except generation.GenerationError as e:
        log.warning("generation failed session=%s: %s", session.id, e)
        if e.retryable and not final_attempt:
            session.status = "queued"
            db.commit()
            raise RetryableJobError(str(e)) from None
        return _fail(db, session, e.customer_message)

    cited = set(result.answer["cited_article_ids"])
    for rank, h in enumerate(hits):
        db.add(SupportAiReference(session_id=session.id, article_id=h.article.id, rank=rank, score=round(h.score, 4), scope=h.article.scope, cited=h.article.id in cited))
    session.answer, session.model, session.usage = result.answer, result.model, result.usage
    session.status, session.answered_at, session.failure = "answered", datetime.now(timezone.utc), None
    db.commit()
    log.info("answered session=%s articles=%s cited=%s model=%s", session.id, len(hits), len(cited), result.model)


def _fail(db: Session, session: SupportAiSession, message: str) -> None:
    session.status, session.failure = "failed", message[:300]
    db.commit()
