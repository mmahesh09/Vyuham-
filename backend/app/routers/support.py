"""Support tickets (customers and staff), error groups from GlitchTip, and the support metrics.

Customers see their own workspace's tickets and never staff-only notes. Staff (SUPPORT_STAFF_EMAILS)
see every ticket under /support/admin. GlitchTip calls /support/webhooks/glitchtip when it sees a
new issue; staff then attach a help article, which the error screen and API 500s point people to.
"""

from __future__ import annotations

import hmac
import json
import logging
import re
import statistics
import tempfile
from datetime import datetime, timedelta, timezone

import os
import unicodedata
import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.auth_tables import user_table
from app.config import get_settings
from app.db import get_db
from app.errors import normalize_title
from app.kb_search import search
from app.models import (
    ErrorGroup,
    KbArticle,
    KbDeflection,
    Notification,
    SupportTicket,
    TicketAttachment,
    TicketMessage,
    Workspace,
    WorkspaceMember,
)
from app.reports.storage import get_attachment_storage
from app.security import AuthUser, current_membership, current_user, is_staff, require_staff
from app.support_schemas import (
    ArticleRef,
    AttachmentOut,
    ErrorGroupOut,
    ErrorGroupPatch,
    ErrorHelpOut,
    LatestReplyOut,
    MessageIn,
    MessageOut,
    StaffArticleOut,
    StaffMessageIn,
    StaffTicketDetailOut,
    StaffTicketOut,
    SupportMetrics,
    TicketDetailOut,
    TicketIn,
    TicketOut,
    TicketPatch,
)

log = logging.getLogger("app.support")
router = APIRouter(prefix="/support", tags=["support"])
MAX_WEBHOOK_BYTES = 64 * 1024


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(d: datetime | None) -> datetime | None:
    return None if d is None else (d if d.tzinfo else d.replace(tzinfo=timezone.utc))


def _email_staff(subject: str, body: str, link: str) -> None:
    from app.notify import send_email

    staff = sorted(get_settings().staff_emails)
    if staff:
        send_email(staff, subject, body, link)


def _user_contact(db: Session, user_id: str | None) -> tuple[str, str]:
    if not user_id:
        return "", ""
    row = db.execute(select(user_table.c.name, user_table.c.email).where(user_table.c.id == user_id)).first()
    return (row.name, row.email) if row else ("", "")


# --- Customer side -----------------------------------------------------------------------------


def _own_ticket(db: Session, ticket_id: str, member: WorkspaceMember) -> SupportTicket:
    t = db.get(SupportTicket, ticket_id)
    if t is None or t.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found")
    return t


def _public_summary(t: SupportTicket) -> TicketOut:
    """The ticket as the customer sees it: internal staff notes never count towards replies."""
    visible = [m for m in t.messages if not m.internal]
    last = visible[-1] if visible else None
    out = TicketOut.model_validate(t)
    out.staff_replied = any(m.is_staff for m in visible)
    if last is not None:
        text = " ".join(last.body.split())
        out.latest_reply = LatestReplyOut(
            author_name=last.author_name,
            is_staff=last.is_staff,
            excerpt=text if len(text) <= 180 else text[:177].rstrip() + "…",
            created_at=last.created_at,
        )
    return out


def _public_detail(db: Session, t: SupportTicket) -> TicketDetailOut:
    out = _public_summary(t).model_dump()
    article = db.get(KbArticle, t.kb_article_id) if t.kb_article_id else None
    ref = ArticleRef(slug=article.slug, title=article.title) if article and article.status == "published" else None
    return TicketDetailOut(**out, messages=[MessageOut.model_validate(m) for m in t.messages if not m.internal], kb_article=ref)


# --- Attachments -------------------------------------------------------------------------------

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
# Extension -> the content type we store and serve. The client's own content type is never trusted.
ATTACHMENT_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".log": "text/plain",
    ".csv": "text/csv",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
INLINE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}  # shown in the browser; everything else downloads


def _looks_like(content_type: str, head: bytes) -> bool:
    """The file's first bytes match what its extension claims."""
    if content_type == "image/png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/jpeg":
        return head.startswith(b"\xff\xd8\xff")
    if content_type == "image/gif":
        return head.startswith((b"GIF87a", b"GIF89a"))
    if content_type == "image/webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if content_type == "application/pdf":
        return head.startswith(b"%PDF-")
    if content_type.startswith("application/vnd.openxmlformats"):
        return head.startswith(b"PK\x03\x04")
    return b"\x00" not in head  # text: no binary content


def _clean_filename(name: str | None) -> str:
    base = os.path.basename((name or "").replace("\\", "/"))
    base = "".join(ch for ch in unicodedata.normalize("NFC", base) if unicodedata.category(ch)[0] != "C").strip(" .")
    if len(base) > 200:
        stem, ext = os.path.splitext(base)
        base = stem[: 200 - len(ext)] + ext
    return base or "file"


def _read_attachment(file: UploadFile) -> bytes:
    chunks, size = [], 0
    while chunk := file.file.read(1024 * 1024):
        size += len(chunk)
        if size > MAX_ATTACHMENT_BYTES:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Files can be up to 10 MB each.")
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/attachments", response_model=AttachmentOut, status_code=status.HTTP_201_CREATED)
def upload_attachment(
    file: UploadFile = File(...),
    user: AuthUser = Depends(current_user),
    member: WorkspaceMember = Depends(current_membership),
    db: Session = Depends(get_db),
):
    """Upload one file for a request or reply. It's linked when the message is sent (attachment_ids)."""
    filename = _clean_filename(file.filename)
    content_type = ATTACHMENT_TYPES.get(os.path.splitext(filename)[1].lower())
    if content_type is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Attach images (PNG, JPG, GIF, WebP), PDFs, text, CSV or Excel files.")
    data = _read_attachment(file)
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That file is empty.")
    if not _looks_like(content_type, data[:8192]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That file's contents don't match its type. Try saving it again.")

    att_id = uuid.uuid4().hex
    a = TicketAttachment(
        id=att_id, workspace_id=member.workspace_id, uploader_id=user.id, filename=filename, content_type=content_type,
        size=len(data), storage_key=f"support/{member.workspace_id}/{att_id}",
    )
    db.add(a)
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        get_attachment_storage().put(a.storage_key, tmp_path)
    finally:
        os.unlink(tmp_path)
    db.commit()
    return AttachmentOut.model_validate(a)


def _link_attachments(db: Session, ids: list[str], uploader_id: str, ticket: SupportTicket, message: TicketMessage) -> None:
    """Attach the caller's own, not-yet-used uploads to a message (after the message is flushed)."""
    ids = list(dict.fromkeys(ids))
    if not ids:
        return
    rows = db.scalars(select(TicketAttachment).where(TicketAttachment.id.in_(ids))).all()
    if len(rows) != len(ids) or any(a.uploader_id != uploader_id or a.message_id is not None for a in rows):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "One of the attachments is missing or already used. Please add it again.")
    for a in rows:
        a.ticket_id, a.workspace_id = ticket.id, ticket.workspace_id
        message.attachments.append(a)


@router.get("/attachments/{attachment_id}")
def download_attachment(attachment_id: str, user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    a = db.get(TicketAttachment, attachment_id)
    allowed = False
    if a is not None:
        if is_staff(user):
            allowed = True
        elif a.message_id is None:
            allowed = a.uploader_id == user.id  # your own upload, not sent yet
        else:
            from app.tenancy import effective_role

            msg = db.get(TicketMessage, a.message_id)
            allowed = bool(msg and not msg.internal and a.workspace_id and effective_role(db, user.id, a.workspace_id))
    if not allowed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found")
    disposition = "inline" if a.content_type in INLINE_TYPES else "attachment"
    return StreamingResponse(
        get_attachment_storage().stream(a.storage_key),
        media_type=a.content_type,
        headers={
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(a.filename)}",
            "Content-Length": str(a.size),
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
            "Cache-Control": "private, max-age=3600",
        },
    )


def prune_attachments(db: Session, now: datetime | None = None, max_age_hours: int = 24) -> int:
    """Delete uploads that were never sent with a message."""
    cutoff = (now or _now()) - timedelta(hours=max_age_hours)
    stale = db.scalars(select(TicketAttachment).where(TicketAttachment.message_id.is_(None), TicketAttachment.created_at < cutoff)).all()
    storage = get_attachment_storage()
    for a in stale:
        try:
            storage.delete(a.storage_key)
        except Exception:  # a missing file mustn't keep the row forever
            log.warning("couldn't delete attachment file %s", a.storage_key)
        db.delete(a)
    db.commit()
    return len(stale)


# --- Tickets -----------------------------------------------------------------------------------


@router.post("/tickets", response_model=TicketDetailOut, status_code=status.HTTP_201_CREATED)
def create_ticket(
    body: TicketIn,
    request: Request,
    user: AuthUser = Depends(current_user),
    member: WorkspaceMember = Depends(current_membership),
    db: Session = Depends(get_db),
):
    t = SupportTicket(
        workspace_id=member.workspace_id,
        user_id=user.id,
        subject=body.subject,
        category=body.category,
        priority="high" if body.category == "bug" and body.error_event_id else "normal",
        page_url=body.page_url,
        error_event_id=body.error_event_id,
        user_agent=(request.headers.get("user-agent") or "")[:300] or None,
    )
    first = TicketMessage(author_id=user.id, author_name=user.name, body=body.body)
    t.messages.append(first)
    db.add(t)
    db.flush()
    _link_attachments(db, body.attachment_ids, user.id, t, first)
    db.commit()
    db.refresh(t)
    _email_staff(
        f"New support request: {t.subject}",
        f"{user.name} ({user.email}) wrote:\n\n{body.body[:2000]}",
        f"/support/admin/tickets/{t.id}",
    )
    return _public_detail(db, t)


@router.get("/tickets", response_model=list[TicketOut])
def list_tickets(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(SupportTicket)
        .where(SupportTicket.workspace_id == member.workspace_id)
        .options(selectinload(SupportTicket.messages))
        .order_by(SupportTicket.updated_at.desc())
        .limit(200)
    ).all()
    return [_public_summary(t) for t in rows]


@router.get("/tickets/{ticket_id}", response_model=TicketDetailOut)
def get_ticket(ticket_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return _public_detail(db, _own_ticket(db, ticket_id, member))


@router.post("/tickets/{ticket_id}/messages", response_model=TicketDetailOut)
def reply(
    ticket_id: str,
    body: MessageIn,
    user: AuthUser = Depends(current_user),
    member: WorkspaceMember = Depends(current_membership),
    db: Session = Depends(get_db),
):
    t = _own_ticket(db, ticket_id, member)
    if t.status == "closed":
        raise HTTPException(status.HTTP_409_CONFLICT, "This request is closed. Open a new one and mention this one.")
    msg = TicketMessage(author_id=user.id, author_name=user.name, body=body.body)
    t.messages.append(msg)
    t.status, t.resolved_at = "open", None  # the customer replied: back in the staff queue
    t.updated_at = _now()
    db.flush()
    _link_attachments(db, body.attachment_ids, user.id, t, msg)
    db.commit()
    db.refresh(t)
    _email_staff(f"Reply on: {t.subject}", f"{user.name} replied:\n\n{body.body[:2000]}", f"/support/admin/tickets/{t.id}")
    return _public_detail(db, t)


@router.post("/tickets/{ticket_id}/resolve", response_model=TicketDetailOut)
def resolve(ticket_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    t = _own_ticket(db, ticket_id, member)
    if t.status not in ("resolved", "closed"):
        t.status, t.resolved_at = "resolved", _now()
        db.commit()
        db.refresh(t)
    return _public_detail(db, t)


# --- Errors: the help lookup (public) and the GlitchTip webhook ---------------------------------


def help_for_title(db: Session, title: str) -> KbArticle | None:
    """The published article attached to the error group whose title matches this error, if any."""
    want = normalize_title(title)
    if not want:
        return None
    rows = db.execute(
        select(ErrorGroup.title, KbArticle)
        .join(KbArticle, KbArticle.id == ErrorGroup.kb_article_id)
        .where(KbArticle.status == "published")
        .order_by(ErrorGroup.last_seen.desc())
        .limit(500)
    ).all()
    for group_title, article in rows:
        have = normalize_title(group_title)
        if have == want or (len(want) >= 12 and (want in have or have in want)):
            return article
    return None


@router.get("/errors/help", response_model=ErrorHelpOut | None)
def error_help(title: str = Query(min_length=3, max_length=300), db: Session = Depends(get_db)):
    """Used by the error screen: "We've seen this before" when staff have written up the fix."""
    a = help_for_title(db, title)
    return ErrorHelpOut(slug=a.slug, title=a.title, summary=a.summary) if a else None


ISSUE_ID = re.compile(r"/issues/(\d+)")


def _parse_glitchtip(payload: dict) -> list[dict]:
    """GlitchTip sends Slack-style webhooks: one attachment per issue, title_link pointing at it."""
    out = []
    for att in payload.get("attachments") or []:
        if not isinstance(att, dict):
            continue
        link = str(att.get("title_link") or "")[:500]
        m = ISSUE_ID.search(link)
        title = str(att.get("title") or "").strip()[:300]
        if not (m and title):
            continue
        culprit = str(att.get("text") or "")[:300] or None
        fields = {str(f.get("title") or "").lower(): str(f.get("value") or "") for f in att.get("fields") or [] if isinstance(f, dict)}
        out.append({
            "issue_id": m.group(1), "title": title, "culprit": culprit, "url": link or None,
            "release": fields.get("release", "")[:100] or None,
            # GlitchTip culprits look like "app.routers.datasets in upload_dataset"; keep the module part.
            "module": (culprit.split(" in ")[0].strip()[:200] or None) if culprit else None,
        })
    return out


@router.post("/webhooks/glitchtip", status_code=status.HTTP_204_NO_CONTENT)
async def glitchtip_webhook(request: Request, db: Session = Depends(get_db)):
    secret = get_settings().glitchtip_webhook_secret
    given = request.query_params.get("secret") or request.headers.get("x-webhook-secret") or ""
    if not secret or not hmac.compare_digest(given.encode(), secret.encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bad webhook secret")
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_WEBHOOK_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Payload too large")
    raw = await request.body()
    if len(raw) > MAX_WEBHOOK_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Payload too large")
    try:
        payload = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Expected JSON") from None
    if not isinstance(payload, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Expected a JSON object")

    new_groups = []
    for issue in _parse_glitchtip(payload):
        g = db.scalar(select(ErrorGroup).where(ErrorGroup.glitchtip_issue_id == issue["issue_id"]))
        if g is None:
            g = ErrorGroup(
                glitchtip_issue_id=issue["issue_id"], title=issue["title"], culprit=issue["culprit"], url=issue["url"],
                release=issue["release"], module=issue["module"],
            )
            db.add(g)
            new_groups.append(g)
        else:
            g.count += 1
            g.last_seen = _now()
            g.release = issue["release"] or g.release
            if g.status == "fixed":  # it came back
                g.status = "known"
    db.commit()
    for g in new_groups:
        _notify_staff_in_app(db, f"New error: {g.title}", g.culprit or "Seen for the first time.", "/support/admin/errors")
        _email_staff(f"New error: {g.title}", f"{g.title}\n{g.culprit or ''}\n\nWrite up the fix so customers see it next time.", "/support/admin/errors")
    if new_groups:
        db.commit()


def _notify_staff_in_app(db: Session, title: str, body: str, link: str) -> None:
    staff = get_settings().staff_emails
    if not staff:
        return
    rows = db.execute(
        select(WorkspaceMember.user_id, WorkspaceMember.workspace_id)
        .join(user_table, user_table.c.id == WorkspaceMember.user_id)
        .where(func.lower(user_table.c.email).in_(staff))
    ).all()
    for uid, wid in rows:
        db.add(Notification(workspace_id=wid, user_id=uid, title=title[:300], body=body, link=link, kind="alert"))


# --- Staff side --------------------------------------------------------------------------------

admin = APIRouter(prefix="/support/admin", tags=["support-admin"], dependencies=[Depends(require_staff)])


def _staff_out(db: Session, t: SupportTicket, detail: bool = False):
    ws = db.get(Workspace, t.workspace_id)
    name, email = _user_contact(db, t.user_id)
    base = StaffTicketOut.model_validate(t).model_dump() | {
        "workspace_name": ws.name if ws else "",
        "requester_name": name,
        "requester_email": email,
        "page_url": t.page_url,
        "error_group_id": t.error_group_id,
        "first_response_at": t.first_response_at,
    }
    if detail:
        return StaffTicketDetailOut(**base, messages=[MessageOut.model_validate(m) for m in t.messages])
    return StaffTicketOut(**base)


def _ticket(db: Session, ticket_id: str) -> SupportTicket:
    t = db.get(SupportTicket, ticket_id)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found")
    return t


@admin.get("/tickets", response_model=list[StaffTicketOut])
def staff_list(
    status_: str | None = Query(default=None, alias="status", pattern="^(open|pending|resolved|closed|active)$"),
    q: str | None = Query(default=None, max_length=200),
    db: Session = Depends(get_db),
):
    stmt = select(SupportTicket)
    if status_ == "active":
        stmt = stmt.where(SupportTicket.status.in_(["open", "pending"]))
    elif status_:
        stmt = stmt.where(SupportTicket.status == status_)
    if q:
        pat = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        stmt = stmt.where(or_(SupportTicket.subject.ilike(pat, escape="\\"), SupportTicket.id == q))
    rows = db.scalars(stmt.order_by(SupportTicket.updated_at.desc()).limit(300)).all()
    return [_staff_out(db, t) for t in rows]


@admin.get("/tickets/{ticket_id}", response_model=StaffTicketDetailOut)
def staff_get(ticket_id: str, db: Session = Depends(get_db)):
    return _staff_out(db, _ticket(db, ticket_id), detail=True)


@admin.patch("/tickets/{ticket_id}", response_model=StaffTicketDetailOut)
def staff_patch(ticket_id: str, body: TicketPatch, db: Session = Depends(get_db)):
    t = _ticket(db, ticket_id)
    changes = body.model_dump(exclude_unset=True)
    if "error_group_id" in changes and changes["error_group_id"] and db.get(ErrorGroup, changes["error_group_id"]) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "No such error group")
    if "kb_article_id" in changes and changes["kb_article_id"] and db.get(KbArticle, changes["kb_article_id"]) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "No such article")
    for k, v in changes.items():
        setattr(t, k, v)
    if changes.get("status") in ("resolved", "closed") and t.resolved_at is None:
        t.resolved_at = _now()
    elif changes.get("status") in ("open", "pending"):
        t.resolved_at = None
    t.updated_at = _now()
    db.commit()
    db.refresh(t)
    return _staff_out(db, t, detail=True)


@admin.post("/tickets/{ticket_id}/messages", response_model=StaffTicketDetailOut)
def staff_reply(ticket_id: str, body: StaffMessageIn, staff: AuthUser = Depends(require_staff), db: Session = Depends(get_db)):
    t = _ticket(db, ticket_id)
    msg = TicketMessage(author_id=staff.id, author_name=staff.name, is_staff=True, internal=body.internal, body=body.body)
    t.messages.append(msg)
    db.flush()
    _link_attachments(db, body.attachment_ids, staff.id, t, msg)
    if not body.internal:
        if t.first_response_at is None:
            t.first_response_at = _now()
        if t.status == "open":
            t.status = "pending"  # waiting on the customer
    t.updated_at = _now()
    if not body.internal and t.user_id:
        db.add(
            Notification(
                workspace_id=t.workspace_id, user_id=t.user_id, title=f"Support replied: {t.subject}"[:300],
                body=body.body[:500], link=f"/support/{t.id}", kind="alert",
            )
        )
    db.commit()
    db.refresh(t)
    if not body.internal:
        _, email = _user_contact(db, t.user_id)
        if email:
            from app.notify import send_email

            send_email([email], f"Re: {t.subject}", body.body[:4000], f"/support/{t.id}")
    return _staff_out(db, t, detail=True)


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:80].strip("-") or "article"


def unique_slug(db: Session, base: str, exclude_id: str | None = None) -> str:
    slug, n = _slugify(base), 2
    root = slug
    while True:
        hit = db.scalar(select(KbArticle.id).where(KbArticle.slug == slug))
        if hit is None or hit == exclude_id:
            return slug
        slug, n = f"{root}-{n}", n + 1


@admin.post("/tickets/{ticket_id}/to-article", response_model=StaffArticleOut, status_code=status.HTTP_201_CREATED)
def ticket_to_article(ticket_id: str, staff: AuthUser = Depends(require_staff), db: Session = Depends(get_db)):
    """Start a draft help article from a solved ticket: the problem, then what support said."""
    t = _ticket(db, ticket_id)
    if t.kb_article_id and (existing := db.get(KbArticle, t.kb_article_id)):
        return StaffArticleOut.model_validate(existing)
    public = [m for m in t.messages if not m.internal]
    problem = public[0].body if public else ""
    answers = [m.body for m in public if m.is_staff]
    body = "## The problem\n\n" + problem + "\n\n## The fix\n\n" + ("\n\n".join(answers) or "_Write the steps that solved it._")
    a = KbArticle(
        slug=unique_slug(db, t.subject), title=t.subject[:200], summary=problem[:280], body=body,
        tags=[t.category], status="draft", source_ticket_id=t.id, created_by=staff.id,
    )
    db.add(a)
    db.flush()
    t.kb_article_id = a.id
    if t.error_group_id and (g := db.get(ErrorGroup, t.error_group_id)) and not g.kb_article_id:
        g.kb_article_id = a.id
    db.commit()
    db.refresh(a)
    return StaffArticleOut.model_validate(a)


@admin.get("/errors", response_model=list[ErrorGroupOut])
def staff_errors(status_: str | None = Query(default=None, alias="status", pattern="^(new|known|fixed)$"), db: Session = Depends(get_db)):
    stmt = select(ErrorGroup)
    if status_:
        stmt = stmt.where(ErrorGroup.status == status_)
    rows = db.scalars(stmt.order_by((ErrorGroup.status == "new").desc(), ErrorGroup.last_seen.desc()).limit(300)).all()
    counts = dict(
        db.execute(
            select(SupportTicket.error_group_id, func.count()).where(SupportTicket.error_group_id.is_not(None)).group_by(SupportTicket.error_group_id)
        ).all()
    )
    return [ErrorGroupOut.model_validate(g).model_copy(update={"ticket_count": counts.get(g.id, 0)}) for g in rows]


@admin.patch("/errors/{group_id}", response_model=ErrorGroupOut)
def staff_patch_error(group_id: str, body: ErrorGroupPatch, db: Session = Depends(get_db)):
    g = db.get(ErrorGroup, group_id)
    if g is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Error group not found")
    changes = body.model_dump(exclude_unset=True)
    if changes.get("kb_article_id") and db.get(KbArticle, changes["kb_article_id"]) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "No such article")
    for k, v in changes.items():
        setattr(g, k, v)
    if changes.get("kb_article_id") and g.status == "new":
        g.status = "known"
    db.commit()
    db.refresh(g)
    return ErrorGroupOut.model_validate(g)


@admin.get("/suggest", response_model=list[StaffArticleOut])
def staff_suggest(q: str = Query(min_length=2, max_length=200), db: Session = Depends(get_db)):
    """Articles (drafts too) matching a ticket, to link or send as a reply."""
    return [StaffArticleOut.model_validate(a) for a in search(db, q, limit=5, include_drafts=True)]


@admin.get("/metrics", response_model=SupportMetrics)
def metrics(db: Session = Depends(get_db)):
    now = _now()
    week = now - timedelta(days=7)
    tickets_week = db.scalar(select(func.count()).select_from(SupportTicket).where(SupportTicket.created_at >= week)) or 0
    open_tickets = db.scalar(select(func.count()).select_from(SupportTicket).where(SupportTicket.status.in_(["open", "pending"]))) or 0
    pairs = db.execute(
        select(SupportTicket.created_at, SupportTicket.first_response_at).where(
            SupportTicket.first_response_at.is_not(None), SupportTicket.created_at >= now - timedelta(days=30)
        )
    ).all()
    hours = [(_utc(r) - _utc(c)).total_seconds() / 3600 for c, r in pairs]
    deflections = db.scalar(select(func.count()).select_from(KbDeflection).where(KbDeflection.created_at >= week)) or 0
    new_errors = db.scalar(select(func.count()).select_from(ErrorGroup).where(ErrorGroup.first_seen >= week)) or 0
    no_article = db.scalar(
        select(func.count()).select_from(ErrorGroup).where(ErrorGroup.kb_article_id.is_(None), ErrorGroup.status != "fixed")
    ) or 0
    return SupportMetrics(
        tickets_this_week=tickets_week,
        open_tickets=open_tickets,
        median_first_response_hours=round(statistics.median(hours), 1) if hours else None,
        deflections_this_week=deflections,
        deflection_rate=round(deflections / (deflections + tickets_week), 3) if (deflections + tickets_week) else None,
        new_errors_this_week=new_errors,
        errors_without_article=no_article,
    )
