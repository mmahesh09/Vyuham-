"""Internal Vyuham support administration API (docs/support-admin-dashboard.md).

Every route requires a Vyuham administrator or support staff member (support_ai/access.py); anyone
else gets 404. Staff work across workspaces, so what they see is limited to support data that was
redacted on the way in: no customer datasets, dashboards, query results, emails or user names.
Customers are shown by workspace name and a pseudonymous user reference. Every change is audited.
"""

from __future__ import annotations

import hashlib
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import case, distinct, func, or_, select
from sqlalchemy.orm import Session

from app import chatwoot
from app.config import get_settings
from app.db import get_db
from app.models import Workspace
from app.support_ai import audit
from app.support_ai.access import Actor, require_support_staff
from app.support_ai.models import KnowledgeArticle, SupportAiSession, SupportAuditLog, SupportErrorEvent, SupportErrorGroup
from app.support_ai.redact import redact_text

log = logging.getLogger("app.support_admin")
router = APIRouter(prefix="/support/admin", tags=["support-admin"])


def _user_ref(user_id: str | None) -> str | None:
    """A stable pseudonym for a customer user: enough to tell people apart, not to identify them."""
    return "u_" + hashlib.sha256(user_id.encode()).hexdigest()[:10] if user_id else None


def _workspace_names(db: Session, ids: set[str]) -> dict[str, str]:
    if not ids:
        return {}
    return dict(db.execute(select(Workspace.id, Workspace.name).where(Workspace.id.in_(ids))).all())


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


@router.get("/me")
def whoami(actor: Actor = Depends(require_support_staff)):
    """Lets the app show the dashboard link; the server still checks every request."""
    return {"role": actor.role, "email": actor.email}


# ── Overview ────────────────────────────────────────────────────────────────────────────


@router.get("/overview")
def overview(days: int = Query(default=30, ge=1, le=365), _: Actor = Depends(require_support_staff), db: Session = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    in_period = SupportErrorEvent.created_at >= since

    total_events = db.scalar(select(func.count()).select_from(SupportErrorEvent).where(in_period)) or 0
    unique_fingerprints = db.scalar(
        select(func.count(distinct(SupportErrorGroup.fingerprint))).join(SupportErrorEvent, SupportErrorEvent.group_id == SupportErrorGroup.id).where(in_period)
    ) or 0
    unresolved = db.scalar(select(func.count()).select_from(SupportErrorGroup).where(SupportErrorGroup.status == "open")) or 0

    # Of the error groups seen in the period, how many are resolved now.
    seen = select(SupportErrorEvent.group_id).where(in_period).distinct().subquery()
    seen_total, seen_resolved = db.execute(
        select(func.count(), func.coalesce(func.sum(case((SupportErrorGroup.status == "resolved", 1), else_=0)), 0)).where(SupportErrorGroup.id.in_(select(seen.c.group_id)))
    ).one()

    by_module = [
        {"module": m, "events": n}
        for m, n in db.execute(
            select(SupportErrorGroup.module, func.count()).join(SupportErrorEvent, SupportErrorEvent.group_id == SupportErrorGroup.id).where(in_period).group_by(SupportErrorGroup.module).order_by(func.count().desc())
        ).all()
    ]
    version = func.coalesce(SupportErrorEvent.app_version, "unknown")
    by_version = [{"version": v, "events": n} for v, n in db.execute(select(version, func.count()).where(in_period).group_by(version).order_by(func.count().desc()).limit(10)).all()]

    top = db.execute(
        select(
            SupportErrorGroup.fingerprint,
            func.max(SupportErrorGroup.module),
            func.max(SupportErrorGroup.category),
            func.max(SupportErrorGroup.error_type),
            func.max(SupportErrorGroup.normalized_message),
            func.count(SupportErrorEvent.id),
            func.count(distinct(SupportErrorGroup.workspace_id)),
            func.max(SupportErrorEvent.created_at),
            func.sum(case((SupportErrorGroup.status == "open", 1), else_=0)),
        )
        .join(SupportErrorEvent, SupportErrorEvent.group_id == SupportErrorGroup.id)
        .where(in_period)
        .group_by(SupportErrorGroup.fingerprint)
        .order_by(func.count(SupportErrorEvent.id).desc())
        .limit(10)
    ).all()
    top_errors = [
        {"fingerprint": fp, "module": m, "category": c, "error_type": et, "message": msg, "events": n, "workspaces": ws, "last_seen": _iso(last), "open_groups": int(open_ or 0)}
        for fp, m, c, et, msg, n, ws, last, open_ in top
    ]

    day = func.date(SupportErrorEvent.created_at)
    per_day = {str(d): n for d, n in db.execute(select(day, func.count()).where(in_period).group_by(day)).all()}
    start = since.date()
    trend = [{"date": (start + timedelta(days=i)).isoformat(), "events": per_day.get((start + timedelta(days=i)).isoformat(), 0)} for i in range(days + 1)]

    knowledge = dict(db.execute(select(KnowledgeArticle.status, func.count()).group_by(KnowledgeArticle.status)).all())
    sessions_q = select(SupportAiSession).where(SupportAiSession.created_at >= since)
    fb = dict(db.execute(select(SupportAiSession.feedback, func.count()).where(SupportAiSession.created_at >= since).group_by(SupportAiSession.feedback)).all())
    answered = db.scalar(select(func.count()).select_from(sessions_q.where(SupportAiSession.status == "answered").subquery())) or 0
    escalated = db.scalar(select(func.count()).select_from(sessions_q.where(SupportAiSession.escalated_conversation_id.is_not(None)).subquery())) or 0
    rated = fb.get("resolved", 0) + fb.get("unresolved", 0)

    return {
        "days": days,
        "total_events": total_events,
        "unique_fingerprints": unique_fingerprints,
        "unresolved_errors": unresolved,
        "error_resolution_rate": round(seen_resolved / seen_total, 4) if seen_total else None,
        "errors_seen": seen_total,
        "by_module": by_module,
        "by_version": by_version,
        "top_errors": top_errors,
        "trend": trend,
        "knowledge": {"pending": knowledge.get("pending", 0), "approved": knowledge.get("approved", 0), "rejected": knowledge.get("rejected", 0), "archived": knowledge.get("archived", 0)},
        "ai": {"answered": answered, "resolved": fb.get("resolved", 0), "unresolved": fb.get("unresolved", 0), "no_feedback": fb.get(None, 0),
               "resolution_rate": round(fb.get("resolved", 0) / rated, 4) if rated else None, "escalated": escalated},
        "open_tickets": _open_ticket_count(),
    }


def _open_ticket_count() -> int | None:
    s = get_settings()
    if not (s.chatwoot_enabled and s.chatwoot_api_token):
        return None
    try:
        return chatwoot.open_conversations(limit=0)["count"]
    except chatwoot.ChatwootError as e:
        log.warning("couldn't count open tickets: %s", e)
        return None


# ── Errors ──────────────────────────────────────────────────────────────────────────────


def _group_out(g: SupportErrorGroup, names: dict[str, str]) -> dict:
    return {
        "id": g.id, "workspace_id": g.workspace_id, "workspace": names.get(g.workspace_id), "fingerprint": g.fingerprint, "module": g.module,
        "category": g.category, "error_type": g.error_type, "message": g.sample_message, "template": g.normalized_message, "count": g.count,
        "first_seen": _iso(g.first_seen), "last_seen": _iso(g.last_seen), "status": g.status, "resolved_at": _iso(g.resolved_at),
        "resolution_note": g.resolution_note, "regressed_at": _iso(g.regressed_at), "chatwoot_conversation_id": g.chatwoot_conversation_id,
    }


@router.get("/errors")
def list_errors(
    status_: Literal["open", "resolved"] | None = Query(default=None, alias="status"),
    module: str | None = Query(default=None, max_length=32),
    fingerprint: str | None = Query(default=None, max_length=64),
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _: Actor = Depends(require_support_staff),
    db: Session = Depends(get_db),
):
    stmt = select(SupportErrorGroup)
    if status_:
        stmt = stmt.where(SupportErrorGroup.status == status_)
    if module:
        stmt = stmt.where(SupportErrorGroup.module == module)
    if fingerprint:
        stmt = stmt.where(SupportErrorGroup.fingerprint == fingerprint)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(SupportErrorGroup.sample_message).like(like), func.lower(SupportErrorGroup.category).like(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    groups = db.scalars(stmt.order_by(SupportErrorGroup.last_seen.desc()).limit(limit).offset(offset)).all()
    names = _workspace_names(db, {g.workspace_id for g in groups})
    return {"total": total, "errors": [_group_out(g, names) for g in groups]}


def _get_group(db: Session, group_id: str) -> SupportErrorGroup:
    g = db.get(SupportErrorGroup, group_id)
    if g is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Error not found")
    return g


@router.get("/errors/{group_id}")
def error_detail(group_id: str, _: Actor = Depends(require_support_staff), db: Session = Depends(get_db)):
    g = _get_group(db, group_id)
    names = _workspace_names(db, {g.workspace_id})
    events = db.scalars(select(SupportErrorEvent).where(SupportErrorEvent.group_id == g.id).order_by(SupportErrorEvent.created_at.desc()).limit(20)).all()
    sessions = db.scalars(select(SupportAiSession).where(SupportAiSession.error_group_id == g.id).order_by(SupportAiSession.created_at.desc()).limit(10)).all()
    # Articles that could apply: global ones and this workspace's own (never another tenant's).
    articles = db.scalars(
        select(KnowledgeArticle).where(or_(KnowledgeArticle.scope == "global", KnowledgeArticle.workspace_id == g.workspace_id)).order_by(KnowledgeArticle.updated_at.desc()).limit(200)
    ).all()
    matching = [a for a in articles if g.fingerprint in (a.fingerprints or []) or g.category in (a.categories or [])][:10]
    history = db.scalars(select(SupportAuditLog).where(SupportAuditLog.target_id == g.id).order_by(SupportAuditLog.created_at.desc()).limit(50)).all()
    return {
        **_group_out(g, names),
        "events": [
            # Diagnostics were redacted on ingestion; shown as stored.
            {"id": e.id, "at": _iso(e.created_at), "message": e.message, "details": e.details, "app_version": e.app_version, "user": _user_ref(e.user_id)}
            for e in events
        ],
        "ai_sessions": [_session_out(s, names) for s in sessions],
        "articles": [_article_brief(a) for a in matching],
        "audit": [_audit_out(r) for r in history],
    }


class ResolveIn(BaseModel):
    note: str = Field(min_length=3, max_length=1000)


@router.post("/errors/{group_id}/resolve")
def resolve_error(group_id: str, body: ResolveIn, actor: Actor = Depends(require_support_staff), db: Session = Depends(get_db)):
    g = _get_group(db, group_id)
    before = {"status": g.status}
    g.status, g.resolved_at, g.resolved_by, g.resolution_note = "resolved", datetime.now(timezone.utc), actor.id, redact_text(body.note)[:1000]
    audit.record(db, actor, "error.resolve", "error_group", g.id, workspace_id=g.workspace_id, changes=audit.diff(before, {"status": g.status}), note=g.resolution_note)
    db.commit()
    return _group_out(g, _workspace_names(db, {g.workspace_id}))


@router.post("/errors/{group_id}/reopen")
def reopen_error(group_id: str, actor: Actor = Depends(require_support_staff), db: Session = Depends(get_db)):
    g = _get_group(db, group_id)
    before = {"status": g.status}
    g.status, g.resolved_at, g.resolved_by = "open", None, None
    audit.record(db, actor, "error.reopen", "error_group", g.id, workspace_id=g.workspace_id, changes=audit.diff(before, {"status": g.status}))
    db.commit()
    return _group_out(g, _workspace_names(db, {g.workspace_id}))


class LinkIn(BaseModel):
    conversation_id: int = Field(ge=1)


@router.post("/errors/{group_id}/ticket")
def link_ticket(group_id: str, body: LinkIn, actor: Actor = Depends(require_support_staff), db: Session = Depends(get_db)):
    """Link the error to a Chatwoot conversation from the *same workspace* (checked against Chatwoot)."""
    g = _get_group(db, group_id)
    s = get_settings()
    if not (s.chatwoot_enabled and s.chatwoot_api_token):
        raise HTTPException(status.HTTP_409_CONFLICT, "Chatwoot isn't configured")
    try:
        conv = chatwoot.get_conversation(body.conversation_id)
    except chatwoot.ChatwootError as e:
        log.warning("ticket lookup failed: %s", e)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Couldn't reach Chatwoot") from None
    if conv is None or conv.get("inbox_id") != s.chatwoot_inbox_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No such conversation in the Vyuham support inbox")
    owner = chatwoot.parse_identifier(chatwoot.conversation_identifier(conv))
    if owner is None or owner[0] != g.workspace_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That conversation belongs to a different customer workspace")
    before = {"chatwoot_conversation_id": g.chatwoot_conversation_id}
    g.chatwoot_conversation_id = body.conversation_id
    audit.record(db, actor, "error.link_ticket", "error_group", g.id, workspace_id=g.workspace_id, changes=audit.diff(before, {"chatwoot_conversation_id": g.chatwoot_conversation_id}))
    db.commit()
    return _group_out(g, _workspace_names(db, {g.workspace_id}))


@router.delete("/errors/{group_id}/ticket")
def unlink_ticket(group_id: str, actor: Actor = Depends(require_support_staff), db: Session = Depends(get_db)):
    g = _get_group(db, group_id)
    before = {"chatwoot_conversation_id": g.chatwoot_conversation_id}
    g.chatwoot_conversation_id = None
    audit.record(db, actor, "error.unlink_ticket", "error_group", g.id, workspace_id=g.workspace_id, changes=audit.diff(before, {"chatwoot_conversation_id": None}))
    db.commit()
    return _group_out(g, _workspace_names(db, {g.workspace_id}))


# ── AI suggestions, feedback, tickets ───────────────────────────────────────────────────


def _session_out(s: SupportAiSession, names: dict[str, str]) -> dict:
    a = s.answer or {}
    return {
        "id": s.id, "workspace_id": s.workspace_id, "workspace": names.get(s.workspace_id), "user": _user_ref(s.user_id), "module": s.module,
        "question": s.question, "status": s.status, "summary": a.get("summary"), "likely_root_cause": a.get("likely_root_cause"),
        "confidence": a.get("confidence"), "steps": a.get("steps", []), "grounded": a.get("grounded"), "cited_article_ids": a.get("cited_article_ids", []),
        "feedback": s.feedback, "feedback_comment": s.feedback_comment, "escalated_conversation_id": s.escalated_conversation_id,
        "error_group_id": s.error_group_id, "created_at": _iso(s.created_at), "model": s.model,
    }


def _article_brief(a: KnowledgeArticle) -> dict:
    return {"id": a.id, "title": a.title, "scope": a.scope, "workspace_id": a.workspace_id, "status": a.status, "source": a.source,
            "helpful_count": a.helpful_count, "unhelpful_count": a.unhelpful_count, "updated_at": _iso(a.updated_at)}


@router.get("/ai-suggestions")
def ai_suggestions(
    feedback: Literal["resolved", "unresolved", "none"] | None = None,
    grounded: bool | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    _: Actor = Depends(require_support_staff),
    db: Session = Depends(get_db),
):
    stmt = select(SupportAiSession).where(SupportAiSession.status == "answered")
    if feedback == "none":
        stmt = stmt.where(SupportAiSession.feedback.is_(None))
    elif feedback:
        stmt = stmt.where(SupportAiSession.feedback == feedback)
    rows = db.scalars(stmt.order_by(SupportAiSession.created_at.desc()).limit(limit * 2)).all()
    if grounded is not None:
        rows = [r for r in rows if bool((r.answer or {}).get("grounded")) == grounded]
    rows = rows[:limit]
    names = _workspace_names(db, {r.workspace_id for r in rows})
    return {"sessions": [_session_out(r, names) for r in rows]}


@router.post("/sessions/{session_id}/draft-article", status_code=status.HTTP_201_CREATED)
def draft_from_session(session_id: str, actor: Actor = Depends(require_support_staff), db: Session = Depends(get_db)):
    """Turn an AI answer into a *pending, workspace-private* draft for review. Never global, never auto-approved."""
    s = db.get(SupportAiSession, session_id)
    if s is None or not s.answer:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Answer not found")
    a = s.answer
    article = KnowledgeArticle(
        scope="tenant", workspace_id=s.workspace_id, title=redact_text(a.get("summary") or s.question)[:200], symptoms=s.question,
        root_cause=a.get("likely_root_cause", ""), resolution="\n".join(f"- {st['text']}" for st in a.get("steps", [])) or a.get("summary", ""),
        modules=[s.module], status="pending", tested=False, source="ai_session", source_ref=s.id, created_by=actor.id,
    )
    db.add(article)
    db.flush()
    audit.record(db, actor, "article.draft_from_ai", "article", article.id, workspace_id=s.workspace_id, changes=audit.diff({}, audit.snapshot(article)), note=f"from AI session {s.id}")
    db.commit()
    return _article_brief(article)


@router.get("/feedback")
def feedback_summary(days: int = Query(default=30, ge=1, le=365), _: Actor = Depends(require_support_staff), db: Session = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    by_module: dict[str, dict] = defaultdict(lambda: {"resolved": 0, "unresolved": 0})
    for module, fb, n in db.execute(
        select(SupportAiSession.module, SupportAiSession.feedback, func.count()).where(SupportAiSession.created_at >= since, SupportAiSession.feedback.is_not(None)).group_by(SupportAiSession.module, SupportAiSession.feedback)
    ).all():
        by_module[module][fb] = n
    recent = db.scalars(
        select(SupportAiSession).where(SupportAiSession.feedback.is_not(None), SupportAiSession.created_at >= since).order_by(SupportAiSession.feedback_at.desc()).limit(30)
    ).all()
    names = _workspace_names(db, {r.workspace_id for r in recent})
    articles = db.scalars(select(KnowledgeArticle).where(KnowledgeArticle.helpful_count + KnowledgeArticle.unhelpful_count > 0).order_by((KnowledgeArticle.helpful_count + KnowledgeArticle.unhelpful_count).desc()).limit(20)).all()
    return {
        "by_module": [{"module": m, **v} for m, v in sorted(by_module.items())],
        "recent": [_session_out(r, names) for r in recent],
        "articles": [_article_brief(a) for a in articles],
    }


@router.get("/tickets")
def tickets(_: Actor = Depends(require_support_staff), db: Session = Depends(get_db)):
    s = get_settings()
    linked = db.scalars(select(SupportErrorGroup).where(SupportErrorGroup.chatwoot_conversation_id.is_not(None)).order_by(SupportErrorGroup.last_seen.desc()).limit(100)).all()
    names = _workspace_names(db, {g.workspace_id for g in linked})
    out: dict = {"configured": bool(s.chatwoot_enabled and s.chatwoot_api_token), "open": None, "linked_errors": [_group_out(g, names) for g in linked]}
    if out["configured"]:
        try:
            data = chatwoot.open_conversations()
            ws_names = _workspace_names(db, {c["workspace_id"] for c in data["conversations"] if c["workspace_id"]})
            out["open"] = {"count": data["count"], "conversations": [{**c, "workspace": ws_names.get(c["workspace_id"])} for c in data["conversations"]]}
        except chatwoot.ChatwootError as e:
            log.warning("couldn't list tickets: %s", e)
            out["error"] = "Couldn't reach Chatwoot"
    return out


# ── Audit log ───────────────────────────────────────────────────────────────────────────


def _audit_out(r: SupportAuditLog) -> dict:
    return {"id": r.id, "at": _iso(r.created_at), "actor": r.actor_email, "role": r.actor_role, "action": r.action, "target_type": r.target_type,
            "target_id": r.target_id, "workspace_id": r.workspace_id, "changes": r.changes, "note": r.note}


@router.get("/audit")
def audit_log(
    target_id: str | None = Query(default=None, max_length=32),
    action: str | None = Query(default=None, max_length=40),
    limit: int = Query(default=100, ge=1, le=500),
    _: Actor = Depends(require_support_staff),
    db: Session = Depends(get_db),
):
    stmt = select(SupportAuditLog)
    if target_id:
        stmt = stmt.where(SupportAuditLog.target_id == target_id)
    if action:
        stmt = stmt.where(SupportAuditLog.action == action)
    return {"entries": [_audit_out(r) for r in db.scalars(stmt.order_by(SupportAuditLog.created_at.desc()).limit(limit))]}
