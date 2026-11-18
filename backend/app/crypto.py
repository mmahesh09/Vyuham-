"""Encryption for secrets we must be able to read back (database connection passwords).

Fernet (AES-128-CBC + HMAC-SHA256) with MultiFernet: CONNECTIONS_KEY holds one or more keys,
comma-separated and newest first. New values are encrypted with the first key; any listed key can
decrypt, so a key can be rotated by putting the new one in front and re-saving connections.

In development without CONNECTIONS_KEY, a key is derived from SIGNING_SECRET so local setups just
work. Production refuses to start without CONNECTIONS_KEY (app/config.py).
"""

from __future__ import annotations

import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.config import get_settings


class SecretError(ValueError):
    """A stored secret can't be decrypted (wrong or rotated-out key)."""


@lru_cache
def _fernet() -> MultiFernet:
    s = get_settings()
    keys = [k.strip() for k in s.connections_key.split(",") if k.strip()]
    if not keys:
        derived = hashlib.sha256(("vyuham-connections:" + s.signing_secret).encode()).digest()
        keys = [base64.urlsafe_b64encode(derived).decode()]
    return MultiFernet([Fernet(k.encode()) for k in keys])


def encrypt(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as e:
        raise SecretError("The saved password can't be read. Re-enter it on the connection.") from e


def reset() -> None:
    """Forget cached keys (tests that change settings)."""
    _fernet.cache_clear()
