"""Deliver alert and automation messages: in-app (the bell), email (logged for now), webhook.

Webhooks are user-supplied URLs the server calls, so they must be https and must not resolve
to a private, loopback, link-local or otherwise internal address (no SSRF into our network).
"""

from __future__ import annotations

import ipaddress
import json
import logging
import socket
import urllib.error
import urllib.request
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Notification, WorkspaceMember

log = logging.getLogger("app.notify")
WEBHOOK_TIMEOUT = 5


class WebhookError(ValueError):
    pass


def check_webhook_url(url: str) -> None:
    """Raise WebhookError unless the URL is https and points at a public address."""
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise WebhookError("Webhook URLs must start with https://")
    if parsed.username or parsed.password:
        raise WebhookError("Webhook URLs can't contain a username or password")
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise WebhookError("That webhook address doesn't resolve") from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise WebhookError("Webhook URLs must point to a public internet address")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Redirects could bounce us to an internal address after the check, so don't follow them."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


def send_webhook(url: str, payload: dict) -> str:
    try:
        check_webhook_url(url)
        # Slack/Teams incoming webhooks read "text"; other tools get the whole payload.
        data = json.dumps({"text": f"*{payload['title']}*\n{payload['body']}", **payload}).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", "User-Agent": "Vyuham-Alerts/1.0"})
        with urllib.request.build_opener(_NoRedirect).open(req, timeout=WEBHOOK_TIMEOUT) as resp:
            return f"ok ({resp.status})"
    except WebhookError as e:
        return f"blocked: {e}"
    except urllib.error.HTTPError as e:
        return f"failed: HTTP {e.code}"
    except Exception as e:  # network errors must never break the scheduler
        return f"failed: {type(e).__name__}"


def send_email(to: list[str], subject: str, body: str) -> int:
    # TODO: send through an email provider (Resend, Postmark…). Logged until one is configured.
    for addr in to:
        log.warning("[email] to=%s subject=%s\n%s", addr, subject, body)
    return len(to)


def deliver(db: Session, workspace_id: str, channels: dict, title: str, body: str, link: str | None, kind: str) -> dict:
    """Send through every enabled channel. Returns a per-channel summary for the history log."""
    result: dict = {}
    if channels.get("inapp", True):
        members = db.scalars(select(WorkspaceMember.user_id).where(WorkspaceMember.workspace_id == workspace_id)).all()
        for uid in members:
            db.add(Notification(workspace_id=workspace_id, user_id=uid, title=title[:300], body=body, link=link, kind=kind))
        result["inapp"] = len(members)
    emails = [e for e in channels.get("emails") or [] if e]
    if emails:
        result["email"] = send_email(emails, title, body + (f"\n\nOpen: {link}" if link else ""))
    if channels.get("webhook"):
        result["webhook"] = send_webhook(channels["webhook"], {"title": title, "body": body, "link": link, "kind": kind})
    return result
