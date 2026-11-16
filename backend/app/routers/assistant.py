"""AI support assistant API (docs/rag-support-engine.md, docs/ai-support-ui.md).

Identity, workspace and permissions always come from the session. Every lookup of a session, thread
or article is scoped to the signed-in user's workspace (and, for sessions, to the user), and a miss
is a 404 whether the row doesn't exist or belongs to someone else.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import chatwoot
from app.config import get_settings
from app.db import get_db
from app.models import WorkspaceMember
from app.security import AuthUser, current_membership, current_user
from app.support_ai import context as module_context
from app.support_ai import feedback as feedback_service
from app.support_ai import jobs, ratelimit
from app.support_ai.ingestion import ingest_error
from app.support_ai.models import KnowledgeArticle, SupportAiReference, SupportAiSession, SupportErrorGroup
from app.support_ai.redact import redact_text, redact_value
from app.support_ai.search import get_visible_article, visibility_clause

log = logging.getLogger("app.assistant")
router = APIRouter(prefix="/support", tags=["assistant"])

Module = Literal["sql_lab", "dashboard", "automations", "reports", "datasets", "alerts", "auth", "other"]
MAX_CONTEXT_BYTES = 8_000


class ErrorIn(BaseModel):
    module: Module
    message: str = Field(min_length=1, max_length=2000)
    error_type: str | None = Field(default=None, max_length=120)
    http_status: int | None = Field(default=None, ge=100, le=599)
    details: dict[str, Any] | None = None

    @field_validator("details")
    @classmethod
    def _small(cls, v):
        if v is not None and len(json.dumps(v, default=str)) > MAX_CONTEXT_BYTES:
            raise ValueError("details are too large")
        return v


def _ingest(db: Session, user: AuthUser, member: WorkspaceMember, e: ErrorIn):
    ratelimit.check_error_limit(db, user.id)
    return ingest_error(
        db, workspace_id=member.workspace_id, user_id=user.id, module=e.module, message=e.message,
        error_type=e.error_type, http_status=e.http_status, details=e.details,
    )


@router.post("/errors", status_code=status.HTTP_201_CREATED)
def report_error(body: ErrorIn, user: AuthUser = Depends(current_user), member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Error ingestion from the Vyuham app: redacted, normalized and grouped by fingerprint."""
    group = _ingest(db, user, member, body)
    return {"group_id": group.id, "fingerprint": group.fingerprint, "category": group.category, "count": group.count}


@router.get("/assistant/context")
def assistant_context(
    module: str = Query(max_length=32),
    dashboard_id: str | None = Query(default=None, max_length=64),
    member: WorkspaceMember = Depends(current_membership),
    db: Session = Depends(get_db),
):
    """Redacted, module-specific diagnostics from the customer's own workspace, for them to review before sharing."""
    return module_context.build_context(db, member, module, dashboard_id)


class AskIn(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    module: Module = "other"
    thread_id: str | None = Field(default=None, max_length=32, pattern=r"^[a-f0-9]{32}$")
    error: ErrorIn | None = None
    context: dict[str, Any] | None = None

    @field_validator("context")
    @classmethod
    def _small(cls, v):
        if v is not None and len(json.dumps(v, default=str)) > MAX_CONTEXT_BYTES:
            raise ValueError("context is too large")
        return v


def _own_session(db: Session, session_id: str, user: AuthUser, member: WorkspaceMember) -> SupportAiSession:
    s = db.scalar(select(SupportAiSession).where(SupportAiSession.id == session_id, SupportAiSession.user_id == user.id, SupportAiSession.workspace_id == member.workspace_id))
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    return s


def _session_out(db: Session, s: SupportAiSession, workspace_id: str) -> dict:
    refs = db.execute(
        select(SupportAiReference, KnowledgeArticle)
        .join(KnowledgeArticle, KnowledgeArticle.id == SupportAiReference.article_id)
        .where(SupportAiReference.session_id == s.id, visibility_clause(workspace_id))  # still visible to this customer?
        .order_by(SupportAiReference.rank)
    ).all()
    return {
        "id": s.id,
        "thread_id": s.thread_id,
        "module": s.module,
        "question": s.question,
        "status": s.status,
        "answer": s.answer,
        "failure": s.failure,
        "references": [{"id": a.id, "title": a.title, "scope": a.scope, "cited": r.cited, "verified": a.status == "approved" and a.tested} for r, a in refs],
        "feedback": s.feedback,
        "escalated_conversation_id": s.escalated_conversation_id,
        "shared_context": s.context or None,
        "created_at": s.created_at.isoformat(),
        "answered_at": s.answered_at.isoformat() if s.answered_at else None,
    }


@router.post("/assistant/ask", status_code=status.HTTP_202_ACCEPTED)
def ask(body: AskIn, user: AuthUser = Depends(current_user), member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Queue a question. The answer is produced in the background; poll the session."""
    ratelimit.check_ask_limit(db, user.id)
    thread_id = body.thread_id
    if thread_id:
        owned = db.scalar(select(func.count()).where(SupportAiSession.thread_id == thread_id, SupportAiSession.user_id == user.id, SupportAiSession.workspace_id == member.workspace_id))
        if not owned:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    group = _ingest(db, user, member, body.error) if body.error else None
    session = SupportAiSession(
        thread_id=thread_id or uuid.uuid4().hex,
        workspace_id=member.workspace_id,
        user_id=user.id,
        module=body.module,
        question=redact_text(body.question, mask_quoted=False),
        error_group_id=group.id if group else None,
        context=redact_value(body.context) if body.context else {},
    )
    db.add(session)
    db.commit()
    jobs.enqueue(db, "answer_session", session.id)
    log.info("question queued session=%s module=%s error=%s", session.id, session.module, bool(group))
    return _session_out(db, session, member.workspace_id)


@router.get("/assistant/sessions/{session_id}")
def get_session(session_id: str, user: AuthUser = Depends(current_user), member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return _session_out(db, _own_session(db, session_id, user, member), member.workspace_id)


@router.get("/assistant/threads")
def list_threads(user: AuthUser = Depends(current_user), member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """The signed-in person's own assistant conversations, newest first."""
    rows = db.scalars(
        select(SupportAiSession).where(SupportAiSession.user_id == user.id, SupportAiSession.workspace_id == member.workspace_id).order_by(SupportAiSession.created_at.desc()).limit(200)
    ).all()
    threads: dict[str, dict] = {}
    for s in rows:
        t = threads.setdefault(s.thread_id, {"thread_id": s.thread_id, "module": s.module, "title": s.question[:120], "turns": 0, "last_at": s.created_at.isoformat(), "feedback": None, "escalated": False})
        t["turns"] += 1
        t["title"] = s.question[:120]  # rows are newest first: ends on the first question
        t["feedback"] = t["feedback"] or s.feedback
        t["escalated"] = t["escalated"] or bool(s.escalated_conversation_id)
    return {"threads": list(threads.values())[:30]}


@router.get("/assistant/threads/{thread_id}")
def get_thread(thread_id: str, user: AuthUser = Depends(current_user), member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(SupportAiSession).where(SupportAiSession.thread_id == thread_id, SupportAiSession.user_id == user.id, SupportAiSession.workspace_id == member.workspace_id).order_by(SupportAiSession.created_at)
    ).all()
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    return {"thread_id": thread_id, "sessions": [_session_out(db, s, member.workspace_id) for s in rows]}


@router.get("/assistant/articles/{article_id}")
def get_article(article_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """A help article the customer may see: approved, and global or their own workspace's."""
    a = get_visible_article(db, member.workspace_id, article_id)
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Article not found")
    return {"id": a.id, "title": a.title, "scope": a.scope, "symptoms": a.symptoms, "root_cause": a.root_cause, "resolution": a.resolution, "verified": a.tested}


class FeedbackIn(BaseModel):
    resolved: bool
    comment: str | None = Field(default=None, max_length=1000)


@router.post("/assistant/sessions/{session_id}/feedback")
def give_feedback(session_id: str, body: FeedbackIn, user: AuthUser = Depends(current_user), member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    s = _own_session(db, session_id, user, member)
    try:
        feedback_service.record_feedback(db, s, body.resolved, body.comment)
    except feedback_service.FeedbackError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    return {**_session_out(db, s, member.workspace_id), "can_escalate": not body.resolved and get_settings().chatwoot_enabled and bool(get_settings().chatwoot_api_token)}


class EscalateIn(BaseModel):
    message: str | None = Field(default=None, max_length=2000)
    include_diagnostics: bool = False  # explicit consent to attach the shared context and error details


@router.post("/assistant/sessions/{session_id}/escalate", status_code=status.HTTP_201_CREATED)
def escalate(session_id: str, body: EscalateIn, user: AuthUser = Depends(current_user), member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Hand the problem to a person: opens a Chatwoot conversation with what the assistant tried."""
    s = _own_session(db, session_id, user, member)
    settings = get_settings()
    if not (settings.chatwoot_enabled and settings.chatwoot_api_token):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Human support isn't set up yet")
    if s.escalated_conversation_id:
        return {"conversation_id": s.escalated_conversation_id}
    answer = s.answer or {}
    lines = [
        "Escalated from the AI assistant (customer said the answer did not solve it).",
        f"Module: {s.module}",
        f"Question: {s.question}",
    ]
    if body.message:
        lines.append(f"Customer's note: {redact_text(body.message)}")
    if answer:
        lines += [f"Assistant summary: {answer.get('summary', '')}", f"Assistant confidence: {answer.get('confidence', '')}", "Steps suggested:"]
        lines += [f"- [{st['kind']}] {st['text']}" for st in answer.get("steps", [])]
        if answer.get("cited_article_ids"):
            lines.append("Articles cited: " + ", ".join(answer["cited_article_ids"]))
    if body.include_diagnostics:
        diag: dict = {"shared_context": s.context or {}}
        if s.error_group_id:
            g = db.get(SupportErrorGroup, s.error_group_id)
            if g and g.workspace_id == member.workspace_id:
                diag["error"] = {"category": g.category, "type": g.error_type, "message": g.sample_message, "occurrences": g.count, "fingerprint": g.fingerprint}
        lines.append("Diagnostics (shared with the customer's consent, redacted):\n" + json.dumps(redact_value(diag), indent=2, ensure_ascii=False)[:6000])
    else:
        lines.append("Diagnostics: not shared by the customer.")
    lines.append(f"Assistant session: {s.id}")

    identifier = chatwoot.identifier_for(member.workspace_id, user.id)
    try:
        contact = chatwoot.ensure_contact(identifier, user.name, user.email if settings.chatwoot_share_email else None, member.workspace_id)
        conversation_id = chatwoot.create_conversation(contact, "\n".join(lines), labels=["ai-escalation"])
    except chatwoot.ChatwootError as e:
        log.warning("escalation failed session=%s: %s", s.id, e)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Support is temporarily unavailable. Please try again in a few minutes.") from None
    s.escalated_conversation_id, s.escalated_at = conversation_id, datetime.now(timezone.utc)
    if s.feedback is None:
        s.feedback, s.feedback_at = "unresolved", s.escalated_at
    db.commit()
    log.info("escalated session=%s conversation=%s diagnostics=%s", s.id, conversation_id, body.include_diagnostics)
    return {"conversation_id": conversation_id}
