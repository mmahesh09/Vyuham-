"""Server-side Chatwoot integration: customer identity, the Application API and webhook checks.

Everything that needs a Chatwoot secret lives here and runs only in the backend. The browser gets
nothing but its own signed identity (see routers/support.py).

Identity: a customer is `vyuham:<workspace_id>:<user_id>`, always derived from the signed-in session.
Including the workspace keeps tenants apart: support history never follows a person into another
workspace, and an identifier names exactly one membership.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from app.config import get_settings

log = logging.getLogger("app.chatwoot")
TIMEOUT = 10
IDENTIFIER_PREFIX = "vyuham"
WEBHOOK_MAX_AGE_SECONDS = 300


class ChatwootError(Exception):
    """Chatwoot could not be reached or refused a request. Messages never include tokens."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


# ── Identity ─────────────────────────────────────────────────────────────────────────────


def identifier_for(workspace_id: str, user_id: str) -> str:
    return f"{IDENTIFIER_PREFIX}:{workspace_id}:{user_id}"


def parse_identifier(identifier: object) -> tuple[str, str] | None:
    """(workspace_id, user_id) for one of our identifiers, else None."""
    if not isinstance(identifier, str):
        return None
    parts = identifier.split(":")
    if len(parts) != 3 or parts[0] != IDENTIFIER_PREFIX or not parts[1] or not parts[2]:
        return None
    return parts[1], parts[2]


def identifier_hash(identifier: str) -> str:
    """What Chatwoot's identity verification expects: HMAC-SHA256(inbox hmac token, identifier), hex."""
    return hmac.new(get_settings().chatwoot_hmac_token.encode(), identifier.encode(), hashlib.sha256).hexdigest()


# ── Webhooks ─────────────────────────────────────────────────────────────────────────────


def verify_webhook(body: bytes, timestamp: str | None, signature: str | None, now: float | None = None) -> bool:
    """Chatwoot signs `"<timestamp>.<raw body>"` with HMAC-SHA256 and sends `sha256=<hex>`.

    Rejects missing or wrong signatures and timestamps more than five minutes away (replays).
    """
    secret = get_settings().chatwoot_webhook_secret
    if not secret or not timestamp or not signature or not signature.startswith("sha256="):
        return False
    try:
        ts = int(timestamp)
    except ValueError:
        return False
    if abs((now if now is not None else time.time()) - ts) > WEBHOOK_MAX_AGE_SECONDS:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature.removeprefix("sha256="), expected)


# ── Application API ──────────────────────────────────────────────────────────────────────


def _request(method: str, path: str, body: dict | None = None) -> Any:
    """One Application API call as the support agent. Raises ChatwootError on any failure."""
    s = get_settings()
    if not s.chatwoot_api_token:
        raise ChatwootError("Chatwoot API token is not configured")
    base = (s.chatwoot_api_url or s.chatwoot_base_url).rstrip("/")
    url = f"{base}/api/v1/accounts/{s.chatwoot_account_id}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method, headers={"api_access_token": s.chatwoot_api_token, "Content-Type": "application/json", "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:  # noqa: S310 - admin-configured URL
            raw = res.read()
    except urllib.error.HTTPError as e:
        raise ChatwootError(f"Chatwoot answered {e.code} for {method} {path}", e.code) from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ChatwootError(f"Couldn't reach Chatwoot: {getattr(e, 'reason', e)}") from None
    return json.loads(raw) if raw else None


@dataclass
class Contact:
    id: int
    source_id: str | None  # this contact's id in the support inbox, needed to start conversations


def _source_id(contact: dict) -> str | None:
    inbox_id = get_settings().chatwoot_inbox_id
    for ci in contact.get("contact_inboxes") or []:
        if (ci.get("inbox") or {}).get("id") == inbox_id:
            return ci.get("source_id")
    return None


def find_contact(identifier: str) -> Contact | None:
    """The contact with exactly this identifier.

    Uses the exact `equal_to` filter, then re-checks: Chatwoot's contact *search* matches
    identifiers with LIKE '%q%', which could return someone else's contact.
    """
    res = _request(
        "POST",
        "/contacts/filter",
        {"payload": [{"attribute_key": "identifier", "filter_operator": "equal_to", "values": [identifier], "query_operator": None}]},
    )
    for c in (res or {}).get("payload") or []:
        if c.get("identifier") == identifier:
            return Contact(id=int(c["id"]), source_id=_source_id(c))
    return None


def ensure_contact(identifier: str, name: str, email: str | None, workspace_id: str) -> Contact:
    """Find the customer's contact or create it in the support inbox (as the widget would)."""
    s = get_settings()
    contact = find_contact(identifier)
    if contact is None:
        body: dict[str, Any] = {"inbox_id": s.chatwoot_inbox_id, "name": name, "identifier": identifier, "custom_attributes": {"workspace_id": workspace_id}}
        if email:
            body["email"] = email
        res = _request("POST", "/contacts", body)
        created = (res or {}).get("payload", {}).get("contact") or (res or {}).get("payload") or {}
        contact = Contact(id=int(created["id"]), source_id=_source_id(created))
    if contact.source_id is None:
        res = _request("POST", f"/contacts/{contact.id}/contact_inboxes", {"inbox_id": s.chatwoot_inbox_id})
        contact.source_id = (res or {}).get("source_id")
    if not contact.source_id:
        raise ChatwootError("Chatwoot did not return a contact inbox")
    return contact


def contact_conversations(contact_id: int) -> list[dict]:
    res = _request("GET", f"/contacts/{contact_id}/conversations")
    return list((res or {}).get("payload") or [])


def create_conversation(contact: Contact, note: str, labels: list[str]) -> int:
    """Open a conversation for the customer in the support inbox, with `note` for agents. Returns its number.

    Chatwoot only lets the API post *as the customer* in API-type inboxes, never in a website inbox
    (messages/message_builder.rb). Posting the text as a normal message would show the customer's
    words as an agent's reply, so it goes in as a private note that names its author instead.
    """
    s = get_settings()
    res = _request("POST", "/conversations", {"source_id": contact.source_id, "inbox_id": s.chatwoot_inbox_id, "contact_id": contact.id, "status": "open"})
    display_id = int((res or {})["id"])
    _request("POST", f"/conversations/{display_id}/messages", {"content": note, "private": True})
    if labels:
        try:
            _request("POST", f"/conversations/{display_id}/labels", {"labels": labels})
        except ChatwootError as e:  # the conversation exists; a missing label is not worth failing for
            log.warning("Couldn't label Chatwoot conversation %s: %s", display_id, e)
    return display_id
