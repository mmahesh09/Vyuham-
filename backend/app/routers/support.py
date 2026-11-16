"""Customer support through Chatwoot (docs/chatwoot-integration.md).

Who the customer is always comes from the session cookie (current_user / current_membership),
never from the request, so nobody can read or write another person's support conversations.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections import defaultdict, deque
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import chatwoot
from app.config import get_settings
from app.db import get_db
from app.models import ChatwootWebhookDelivery, Notification, WorkspaceMember
from app.security import AuthUser, current_membership, current_user

log = logging.getLogger("app.support")
router = APIRouter(prefix="/support", tags=["support"])

PREVIEW_CHARS = 140
REPORTS_PER_HOUR = 5
_report_times: dict[str, deque[float]] = defaultdict(deque)  # per process; enough to stop accidental floods


def _require_enabled():
    s = get_settings()
    if not s.chatwoot_enabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Support chat isn't set up")
    return s


def _unavailable(e: chatwoot.ChatwootError) -> HTTPException:
    log.warning("Chatwoot request failed: %s", e)
    return HTTPException(status.HTTP_502_BAD_GATEWAY, "Support is temporarily unavailable. Please try again in a few minutes.")


# ── Customer-facing ─────────────────────────────────────────────────────────────────────


@router.get("/config")
def support_config(_: AuthUser = Depends(current_user)):
    """What the support page and widget need. Only public values: no tokens."""
    s = get_settings()
    if not s.chatwoot_enabled:
        return {"enabled": False, "help_center_url": s.chatwoot_help_center_url or None}
    return {
        "enabled": True,
        "base_url": s.chatwoot_base_url.rstrip("/"),
        "website_token": s.chatwoot_website_token,
        "help_center_url": s.chatwoot_help_center_url or None,
        "can_list_conversations": bool(s.chatwoot_api_token),
    }


@router.get("/identity")
def support_identity(user: AuthUser = Depends(current_user), member: WorkspaceMember = Depends(current_membership)):
    """The signed identity the widget logs in with. Minimum data: id, display name, email."""
    s = _require_enabled()
    if not s.chatwoot_hmac_token:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Support identity verification isn't set up")
    identifier = chatwoot.identifier_for(member.workspace_id, user.id)
    return {
        "identifier": identifier,
        "identifier_hash": chatwoot.identifier_hash(identifier),
        "name": user.name,
        "email": user.email if s.chatwoot_share_email else None,
        "workspace_id": member.workspace_id,
    }


def _summary(conv: dict) -> dict:
    """Only what the customer list needs. Agents' private notes and internal fields never leave."""
    preview = None
    for m in reversed(conv.get("messages") or []):
        # 0 = from the customer, 1 = from an agent; skip activity (2), templates (3) and private notes
        if m.get("private") or m.get("message_type") not in (0, 1, "incoming", "outgoing"):
            continue
        text = (m.get("content") or "").strip()
        if text:
            preview = {"from": "you" if m.get("message_type") in (0, "incoming") else "support", "text": text[:PREVIEW_CHARS]}
        break
    return {
        "id": conv.get("id"),
        "status": conv.get("status"),
        "created_at": conv.get("created_at"),
        "last_activity_at": conv.get("last_activity_at") or conv.get("timestamp"),
        "unread_count": conv.get("unread_count", 0),
        "last_message": preview,
    }


@router.get("/conversations")
def my_conversations(user: AuthUser = Depends(current_user), member: WorkspaceMember = Depends(current_membership)):
    """The signed-in customer's own conversations in the Vyuham support inbox, newest first."""
    s = _require_enabled()
    if not s.chatwoot_api_token:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation list isn't set up")
    identifier = chatwoot.identifier_for(member.workspace_id, user.id)
    try:
        contact = chatwoot.find_contact(identifier)
        convs = chatwoot.contact_conversations(contact.id) if contact else []
    except chatwoot.ChatwootError as e:
        raise _unavailable(e) from None
    # Defence in depth: the contact is exact, but keep only this inbox and this contact.
    own = [c for c in convs if c.get("inbox_id") == s.chatwoot_inbox_id and _conversation_identifier(c) in (None, identifier)]
    return {"conversations": [_summary(c) for c in own]}


def _conversation_identifier(conv: dict) -> str | None:
    return ((conv.get("meta") or {}).get("sender") or {}).get("identifier")


class ProblemReport(BaseModel):
    description: str = Field(min_length=10, max_length=4000)
    page: str | None = Field(default=None, max_length=300)
    release: str | None = Field(default=None, max_length=80)
    error_id: str | None = Field(default=None, max_length=64)


_SAFE_PAGE = re.compile(r"^/[A-Za-z0-9/_\-\[\]]*$")
_TOKEN_PATHS = (re.compile(r"^/s/[^/]+"), re.compile(r"^/invite/[^/]+"))


def _clean_page(page: str | None) -> str | None:
    """Path only (no query or fragment, which can hold tokens), with link tokens masked."""
    if not page:
        return None
    path = page.split("?", 1)[0].split("#", 1)[0]
    for pattern, repl in zip(_TOKEN_PATHS, ("/s/[token]", "/invite/[token]")):
        path = pattern.sub(repl, path)
    return path if _SAFE_PAGE.match(path) else None


@router.post("/report", status_code=status.HTTP_201_CREATED)
def report_problem(body: ProblemReport, request: Request, user: AuthUser = Depends(current_user), member: WorkspaceMember = Depends(current_membership)):
    """Open a support conversation labelled `problem-report`, with non-personal context for agents."""
    s = _require_enabled()
    if not s.chatwoot_api_token:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Problem reports aren't set up")
    times = _report_times[user.id]
    now = time.monotonic()
    while times and now - times[0] > 3600:
        times.popleft()
    if len(times) >= REPORTS_PER_HOUR:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "You've sent several reports recently. Please add details to an existing conversation instead.")

    context = [f"Page: {p}" for p in [_clean_page(body.page)] if p]
    if body.release and re.fullmatch(r"[A-Za-z0-9._@+\-]+", body.release):
        context.append(f"App version: {body.release}")
    if body.error_id and re.fullmatch(r"[0-9a-fA-F-]{8,64}", body.error_id):
        context.append(f"Error ID: {body.error_id}")
    agent = (request.headers.get("user-agent") or "")[:200]
    if agent:
        context.append(f"Browser: {agent}")
    note = "Problem report from the customer (sent from Vyuham's Report a problem form):\n\n" + body.description.strip()
    if context:
        note += "\n\n---\n" + "\n".join(context)

    identifier = chatwoot.identifier_for(member.workspace_id, user.id)
    try:
        contact = chatwoot.ensure_contact(identifier, user.name, user.email if s.chatwoot_share_email else None, member.workspace_id)
        conversation_id = chatwoot.create_conversation(contact, note, labels=["problem-report"])
    except chatwoot.ChatwootError as e:
        raise _unavailable(e) from None
    times.append(now)
    return {"conversation_id": conversation_id}


# ── Chatwoot → Vyuham webhook ───────────────────────────────────────────────────────────


@router.post("/chatwoot/webhook")
async def chatwoot_webhook(request: Request, db: Session = Depends(get_db)):
    """Signed events from Chatwoot. Turns agent replies and resolutions into in-app notifications."""
    s = get_settings()
    if not s.chatwoot_webhook_secret:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    body = await request.body()
    if not chatwoot.verify_webhook(body, request.headers.get("x-chatwoot-timestamp"), request.headers.get("x-chatwoot-signature")):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid signature")
    try:
        event = json.loads(body)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid JSON") from None
    name = str(event.get("event") or "")[:64]

    delivery = request.headers.get("x-chatwoot-delivery")
    if delivery:
        db.add(ChatwootWebhookDelivery(delivery_id=delivery[:100], event=name or "unknown"))
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            return {"status": "duplicate"}

    result = _handle_event(db, s, name, event)
    db.commit()
    return {"status": result}


def _handle_event(db: Session, s, name: str, event: dict) -> str:
    conv = event.get("conversation") if name == "message_created" else event
    if not isinstance(conv, dict):
        return "ignored"
    # Only our account and our support inbox.
    account_id = (event.get("account") or {}).get("id") or conv.get("account_id")
    inbox_id = (event.get("inbox") or {}).get("id") or conv.get("inbox_id")
    if account_id != s.chatwoot_account_id or inbox_id != s.chatwoot_inbox_id:
        return "ignored"

    if name == "message_created":
        # A public reply from an agent. Customer messages, private notes and bot activity are skipped.
        if event.get("private") or event.get("message_type") not in ("outgoing", 1) or (event.get("sender") or {}).get("type") not in ("user", "agent_bot"):
            return "ignored"
        text = (event.get("content") or "").strip()
        title, body = "Support replied to your conversation", text[:PREVIEW_CHARS] or "You have a new reply."
    elif name == "conversation_status_changed" and conv.get("status") == "resolved":
        title, body = "Your support conversation was resolved", "Reply in the conversation if you still need help."
    else:
        return "ignored"

    owner = chatwoot.parse_identifier(_conversation_identifier(conv))
    if owner is None:
        return "ignored"  # an anonymous or non-Vyuham contact
    workspace_id, user_id = owner
    # The identifier must still name a real membership: never notify across workspaces.
    member = db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id))
    if member is None:
        return "ignored"
    db.add(Notification(workspace_id=workspace_id, user_id=user_id, title=title, body=body, link="/support", kind="support", created_at=datetime.now(timezone.utc)))
    return "notified"

