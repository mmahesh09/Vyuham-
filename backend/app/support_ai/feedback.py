"""Feedback processing: record whether an answer worked, and propose (never publish) knowledge.

Rules:
  * Feedback updates counters and the session. It never changes an article's status.
  * A "resolved" answer that wasn't backed by an approved article becomes a *pending, private*
    candidate in the customer's own workspace, for staff to review. It is not retrievable until a
    reviewer approves it as tested (approval.py), and it never becomes global by itself.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.support_ai.models import KnowledgeArticle, SupportAiReference, SupportAiSession
from app.support_ai.redact import redact_text

log = logging.getLogger("app.support_ai.feedback")


class FeedbackError(ValueError):
    pass


def record_feedback(db: Session, session: SupportAiSession, resolved: bool, comment: str | None) -> KnowledgeArticle | None:
    """Store feedback once per session. Returns a pending candidate article if one was proposed. Commits."""
    if session.status != "answered":
        raise FeedbackError("This answer isn't ready yet.")
    if session.feedback is not None:
        raise FeedbackError("You've already told us whether this worked.")
    session.feedback = "resolved" if resolved else "unresolved"
    session.feedback_comment = redact_text(comment)[:1000] if comment else None
    session.feedback_at = datetime.now(timezone.utc)

    cited = db.scalars(select(SupportAiReference.article_id).where(SupportAiReference.session_id == session.id, SupportAiReference.cited.is_(True))).all()
    if cited:
        column = KnowledgeArticle.helpful_count if resolved else KnowledgeArticle.unhelpful_count
        db.execute(update(KnowledgeArticle).where(KnowledgeArticle.id.in_(cited)).values({column: column + 1}))

    candidate = None
    answer = session.answer or {}
    if resolved and not answer.get("grounded"):
        steps = "\n".join(f"- {s['text']}" for s in answer.get("steps", []))
        candidate = KnowledgeArticle(
            scope="tenant",
            workspace_id=session.workspace_id,  # private to the customer's workspace
            title=redact_text(answer.get("summary") or session.question)[:200],
            symptoms=session.question,
            root_cause=answer.get("likely_root_cause", ""),
            resolution=steps or answer.get("summary", ""),
            modules=[session.module],
            status="pending",
            tested=False,
            source="customer_feedback",
            source_ref=session.id,
            created_by=session.user_id,
        )
        db.add(candidate)
    db.commit()
    log.info("feedback session=%s resolved=%s candidate=%s", session.id, resolved, candidate.id if candidate else None)
    return candidate
