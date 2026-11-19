"""Deliver alert and automation messages: in-app (the bell), email (logged for now), webhook.

Webhooks are user-supplied URLs the server calls, so they must be https and must not resolve
to a private, loopback, link-local or otherwise internal address (no SSRF into our network).
"""

from __future__ import annotations

import http.client
import ipaddress
import json
import logging
import socket
import ssl
import urllib.error
import urllib.request
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.connectors.base import blocked_address
from app.models import Notification, WorkspaceMember

log = logging.getLogger("app.notify")
WEBHOOK_TIMEOUT = 5


class WebhookError(ValueError):
    pass


def check_webhook_url(url: str) -> str:
    """The public address to connect to; WebhookError unless the URL is https and every address is public."""
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise WebhookError("Webhook URLs must start with https://")
    if parsed.username or parsed.password:
        raise WebhookError("Webhook URLs can't contain a username or password")
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise WebhookError("That webhook address doesn't resolve") from e
    addresses = [info[4][0] for info in infos]
    if not addresses or any(blocked_address(ipaddress.ip_address(a.split("%")[0])) for a in addresses):
        raise WebhookError("Webhook URLs must point to a public internet address")
    return sorted(addresses, key=lambda a: ":" in a)[0]  # IPv4 first


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Redirects could bounce us to an internal address after the check, so don't follow them."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


class _PinnedConnection(http.client.HTTPSConnection):
    """Connects to the address that was checked, while TLS still verifies the URL's host name."""

    pinned_address = ""

    def connect(self) -> None:
        raw = socket.create_connection((self.pinned_address, self.port), self.timeout)
        self.sock = ssl.create_default_context().wrap_socket(raw, server_hostname=self.host)


class _PinnedHTTPS(urllib.request.HTTPSHandler):
    """DNS is asked once: a name can't pass the check and then point somewhere internal."""

    def __init__(self, address: str) -> None:
        super().__init__()
        self.address = address

    def https_open(self, req):  # noqa: ANN001
        address = self.address

        class Connection(_PinnedConnection):
            pinned_address = address

        return self.do_open(Connection, req)


def send_webhook(url: str, payload: dict) -> str:
    try:
        address = check_webhook_url(url)
        # Slack/Teams incoming webhooks read "text"; other tools get the whole payload.
        data = json.dumps({"text": f"*{payload['title']}*\n{payload['body']}", **payload}).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", "User-Agent": "Vyuham-Alerts/1.0"})
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect, _PinnedHTTPS(address))
        with opener.open(req, timeout=WEBHOOK_TIMEOUT) as resp:
            return f"ok ({resp.status})"
    except WebhookError as e:
        return f"blocked: {e}"
    except urllib.error.HTTPError as e:
        return f"failed: HTTP {e.code}"
    except Exception as e:  # network errors must never break the scheduler
        return f"failed: {type(e).__name__}"


def send_email(to: list[str], subject: str, body: str, link: str | None = None) -> int:
    """Alerts and digests by email (Resend; logged when no key is set)."""
    from app.email import app_link, render, send

    url = app_link(link) if link else None
    html_body = render(
        subject,
        [body],
        ("Open in Vyuham", url) if url else None,
        "You're getting this because someone in your workspace added you to an alert or automation.",
    )
    return send(to, subject, html_body, body + (f"\n\nOpen: {url}" if url else ""))


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
        result["email"] = send_email(emails, title, body, link)
    if channels.get("webhook"):
        result["webhook"] = send_webhook(channels["webhook"], {"title": title, "body": body, "link": link, "kind": kind})
    return result
