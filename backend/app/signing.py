"""Short-lived signed tokens: `<base64url payload>.<base64url HMAC-SHA256>`.

Used where a link must work without a session but only for one thing, briefly: the print page a
PDF report is rendered from, and report download links in emails. Each token names its purpose,
so a print token can't be used as a download link or the other way round.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from app.config import get_settings


class BadToken(ValueError):
    pass


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _mac(body: str) -> str:
    key = get_settings().signing_secret.encode()
    return _b64(hmac.new(key, body.encode(), hashlib.sha256).digest())


def sign(purpose: str, data: dict, ttl_seconds: int, now: float | None = None) -> str:
    payload = {"p": purpose, "exp": int((now or time.time()) + ttl_seconds), "d": data}
    body = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    return f"{body}.{_mac(body)}"


def verify(purpose: str, token: str, now: float | None = None) -> dict:
    """The signed data, or BadToken when the token is forged, expired or for another purpose."""
    try:
        body, mac = token.split(".", 1)
    except ValueError:
        raise BadToken("malformed") from None
    if not hmac.compare_digest(mac, _mac(body)):
        raise BadToken("bad signature")
    try:
        payload = json.loads(_unb64(body))
    except ValueError:
        raise BadToken("malformed") from None
    if payload.get("p") != purpose:
        raise BadToken("wrong purpose")
    if payload.get("exp", 0) < (now or time.time()):
        raise BadToken("expired")
    return payload.get("d") or {}
