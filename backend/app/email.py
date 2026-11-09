"""Transactional email through Resend (https://resend.com), with a log fallback for local dev.

Set RESEND_API_KEY and EMAIL_FROM (a sender on a domain verified in Resend) to send for real.
Without a key, messages are written to the log so development works with no setup.
"""

from __future__ import annotations

import html
import json
import logging
import urllib.error
import urllib.request

from app.config import get_settings

log = logging.getLogger("app.email")
RESEND_URL = "https://api.resend.com/emails"
TIMEOUT = 10


def render(title: str, paragraphs: list[str], button: tuple[str, str] | None = None, footer: str | None = None) -> str:
    """A small, email-client-safe HTML layout in the brand colours. All text is escaped."""
    body = "".join(f'<p style="margin:0 0 14px;line-height:1.6;color:#3b3554;white-space:pre-line">{html.escape(p)}</p>' for p in paragraphs)
    cta = ""
    if button:
        label, url = button
        cta = (
            f'<p style="margin:22px 0"><a href="{html.escape(url, quote=True)}" '
            'style="background:#705cbb;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;'
            f'font-weight:600;display:inline-block">{html.escape(label)}</a></p>'
            f'<p style="margin:0 0 14px;font-size:12px;color:#8f86b3">Or paste this link into your browser:<br>{html.escape(url)}</p>'
        )
    foot = html.escape(footer or "You're getting this because of your Vyuham account.")
    return (
        '<!doctype html><html><body style="margin:0;background:#f5f2ff;font-family:Segoe UI,Helvetica,Arial,sans-serif">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">'
        '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px">'
        '<tr><td><p style="margin:0 0 20px;font-weight:700;font-size:18px;color:#705cbb">vyuham</p>'
        f'<h1 style="margin:0 0 16px;font-size:22px;color:#110e22">{html.escape(title)}</h1>{body}{cta}'
        f'<p style="margin:24px 0 0;font-size:12px;color:#8f86b3">{foot}</p></td></tr></table></td></tr></table></body></html>'
    )


def send(to: list[str] | str, subject: str, html_body: str, text_body: str) -> int:
    """Send one message to each recipient. Returns how many were sent (or logged). Never raises."""
    recipients = [to] if isinstance(to, str) else [r for r in to if r]
    if not recipients:
        return 0
    s = get_settings()
    if not s.resend_api_key:
        for r in recipients:
            log.warning("[email:log-only] to=%s subject=%s\n%s", r, subject, text_body)
        return len(recipients)
    sent = 0
    for r in recipients:  # one request per recipient, so people never see each other's addresses
        payload = json.dumps({"from": s.email_from, "to": [r], "subject": subject, "html": html_body, "text": text_body}).encode()
        req = urllib.request.Request(
            RESEND_URL, data=payload, headers={"Authorization": f"Bearer {s.resend_api_key}", "Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                sent += 1 if resp.status < 300 else 0
        except urllib.error.HTTPError as e:
            log.error("[email] Resend refused a message to %s: HTTP %s %s", r, e.code, e.read()[:300])
        except Exception as e:  # network trouble must not break the caller (scheduler, invites)
            log.error("[email] could not reach Resend: %s", type(e).__name__)
    return sent


def app_link(path: str) -> str:
    return get_settings().app_url.rstrip("/") + path
