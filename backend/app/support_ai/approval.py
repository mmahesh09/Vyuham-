"""Knowledge approval: the only way an article becomes retrievable.

  * Every article starts `pending`. Only Vyuham support staff can approve or reject.
  * Approval requires `tested=True` with test notes. The database also enforces approved => tested.
  * Tenant articles stay private to their workspace. Turning one into shared knowledge is an explicit
    *promotion*: staff write a new, generalized global article (pending) and confirm it contains no
    customer data; nothing is copied across tenants automatically.
  * Editing an approved article sends it back to `pending` and removes its embedding.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.support_ai import jobs
from app.support_ai.models import KnowledgeArticle, KnowledgeEmbedding
from app.support_ai.normalize import MODULES
from app.support_ai.redact import redact_text

log = logging.getLogger("app.support_ai.approval")


class ApprovalError(ValueError):
    pass


EDITABLE = ("title", "symptoms", "root_cause", "resolution", "modules", "categories", "fingerprints")


def _clean(fields: dict) -> dict:
    out = {}
    for k in EDITABLE:
        if k not in fields or fields[k] is None:
            continue
        v = fields[k]
        if k in ("modules",):
            out[k] = [m for m in v if m in MODULES][:8]
        elif k in ("categories", "fingerprints"):
            out[k] = [str(x)[:64] for x in v][:20]
        else:
            out[k] = redact_text(v)  # staff text is redacted too, in case a customer detail slipped in
    return out


def create_article(db: Session, staff_id: str, *, scope: str, workspace_id: str | None, **fields) -> KnowledgeArticle:
    if scope == "global" and workspace_id is not None:
        raise ApprovalError("Global articles don't belong to a workspace.")
    if scope == "tenant" and not workspace_id:
        raise ApprovalError("Workspace articles need a workspace.")
    a = KnowledgeArticle(scope=scope, workspace_id=workspace_id, status="pending", tested=False, source="staff", created_by=staff_id, **_clean(fields))
    db.add(a)
    db.commit()
    return a


def edit_article(db: Session, staff_id: str, a: KnowledgeArticle, **fields) -> KnowledgeArticle:
    for k, v in _clean(fields).items():
        setattr(a, k, v)
    a.status, a.tested, a.reviewed_by, a.reviewed_at = "pending", False, None, None
    emb = db.get(KnowledgeEmbedding, a.id)
    if emb:
        db.delete(emb)
    db.commit()
    log.info("article edited article=%s by=%s -> pending", a.id, staff_id)
    return a


def approve(db: Session, staff_id: str, a: KnowledgeArticle, *, tested: bool, test_notes: str, confirm_no_customer_data: bool = False) -> KnowledgeArticle:
    if a.status not in ("pending", "rejected"):
        raise ApprovalError(f"Only pending or rejected articles can be approved (this one is {a.status}).")
    if not tested or not (test_notes or "").strip():
        raise ApprovalError("Only tested solutions can be approved: set tested and describe how it was tested.")
    if a.scope == "global" and not confirm_no_customer_data:
        raise ApprovalError("Confirm the article contains no customer-specific information before sharing it with everyone.")
    if a.scope == "global" and a.source == "customer_feedback":
        raise ApprovalError("Customer-suggested solutions can't be approved as global directly; promote them into a new global article.")
    a.status, a.tested, a.test_notes = "approved", True, redact_text(test_notes)[:2000]
    a.reviewed_by, a.reviewed_at = staff_id, datetime.now(timezone.utc)
    db.commit()
    jobs.enqueue(db, "embed_article", a.id)
    log.info("article approved article=%s scope=%s by=%s", a.id, a.scope, staff_id)
    return a


def reject(db: Session, staff_id: str, a: KnowledgeArticle, note: str) -> KnowledgeArticle:
    a.status, a.review_note = "rejected", redact_text(note)[:1000]
    a.reviewed_by, a.reviewed_at = staff_id, datetime.now(timezone.utc)
    emb = db.get(KnowledgeEmbedding, a.id)
    if emb:
        db.delete(emb)
    db.commit()
    return a


def archive(db: Session, staff_id: str, a: KnowledgeArticle) -> KnowledgeArticle:
    a.status = "archived"
    a.reviewed_by, a.reviewed_at = staff_id, datetime.now(timezone.utc)
    emb = db.get(KnowledgeEmbedding, a.id)
    if emb:
        db.delete(emb)
    db.commit()
    return a


def promote(db: Session, staff_id: str, source: KnowledgeArticle, **generalized) -> KnowledgeArticle:
    """Create a new *pending global* article from a tenant article. Staff must supply the generalized text."""
    if source.scope != "tenant":
        raise ApprovalError("Only workspace articles can be promoted.")
    missing = [k for k in ("title", "symptoms", "root_cause", "resolution") if not (generalized.get(k) or "").strip()]
    if missing:
        raise ApprovalError("Write the generalized article; nothing is copied from the workspace automatically. Missing: " + ", ".join(missing))
    a = KnowledgeArticle(
        scope="global", workspace_id=None, status="pending", tested=False, source="promotion", source_ref=source.id, created_by=staff_id,
        **_clean(generalized),
    )
    db.add(a)
    db.commit()
    log.info("article promoted source=%s new=%s by=%s", source.id, a.id, staff_id)
    return a
