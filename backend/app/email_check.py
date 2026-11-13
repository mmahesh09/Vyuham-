"""Check that an email address can receive mail before Vyuham sends to it (invites).

Uses a self-hosted Reacher backend (github.com/reacherhq/check-if-email-exists): POST
{REACHER_URL}/v0/check_email returns is_reachable = safe | risky | invalid | unknown. Off unless
REACHER_URL is set. Reacher probes mail servers over SMTP, so its host needs outbound port 25.

This never blocks Vyuham on its own trouble: if Reacher is down or slow, the answer is "unknown"
and the caller carries on.
"""

from __future__ import annotations

import json
import logging
import urllib.request
from typing import Literal

from app.config import get_settings

log = logging.getLogger("app.email_check")
Reachability = Literal["safe", "risky", "invalid", "unknown", "skipped"]
TIMEOUT_SECONDS = 10


def _post(url: str, payload: dict, headers: dict[str, str]) -> dict:
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", **headers}, method="POST")
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as res:  # noqa: S310 (server-configured URL)
        return json.loads(res.read())


def check_email(address: str) -> Reachability:
    s = get_settings()
    if not s.reacher_url:
        return "skipped"
    headers = {"x-reacher-secret": s.reacher_secret} if s.reacher_secret else {}
    try:
        result = _post(s.reacher_url.rstrip("/") + "/v0/check_email", {"to_email": address}, headers)
    except Exception:  # network, timeout, bad JSON: don't block the person sending the invite
        log.warning("email check failed for an invite address", exc_info=True)
        return "unknown"
    reach = result.get("is_reachable")
    return reach if reach in ("safe", "risky", "invalid", "unknown") else "unknown"
