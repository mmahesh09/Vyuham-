"""A short-lived cache for query results: chart rows and a column's distinct values.

Keys include the data's version (see `dataset_version`), so an upload, a sync, a column-type change or a
new metric version is a different key: nothing has to be invalidated by hand, and a cached result can
never be stale data. In Redis entries expire after TTL_SECONDS; locally an LRU bounds memory.

Redis when REDIS_URL is set (shared by every API process), otherwise a small in-process LRU. A cache
failure is logged and treated as a miss: it never breaks the request.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from collections import OrderedDict
from collections.abc import Callable
from typing import Any

from app.config import get_settings
from app.telemetry import count

log = logging.getLogger("app.cache")

TTL_SECONDS = 600
MAX_LOCAL_ENTRIES = 256
MAX_CACHED_ROWS = 2_000  # bigger results (data grids, exports) aren't worth the memory
PREFIX = "vyuham:qc:"

_local: OrderedDict[str, str] = OrderedDict()  # JSON text, like Redis: every hit is a fresh copy
_lock = threading.Lock()
_redis = None
_redis_failed = False


def _client():
    global _redis, _redis_failed
    url = get_settings().redis_url
    if not url or _redis_failed:
        return None
    if _redis is None:
        try:
            import redis

            _redis = redis.Redis.from_url(url, socket_timeout=0.5, socket_connect_timeout=0.5)
        except Exception:  # bad URL, driver missing: use the local cache for this process
            log.warning("query cache: Redis unavailable, using the in-process cache")
            _redis_failed = True
            return None
    return _redis


def key(*parts: Any) -> str:
    raw = json.dumps(parts, sort_keys=True, default=str, separators=(",", ":"))
    return PREFIX + hashlib.sha256(raw.encode()).hexdigest()


def dataset_version(dataset: Any, parquet_path: str) -> list:
    """What a dataset's query results depend on: the file's identity and the column definitions
    (types and calculated columns live in `columns`, not in the file)."""
    try:
        st = os.stat(parquet_path)
        stamp = [st.st_mtime_ns, st.st_size]
    except OSError:
        stamp = [None, None]
    cols = hashlib.sha256(json.dumps(dataset.columns, sort_keys=True, default=str).encode()).hexdigest()[:16]
    return [dataset.id, *stamp, cols]


def _get(k: str) -> Any | None:
    r = _client()
    if r is not None:
        try:
            raw = r.get(k)
        except Exception as e:  # Redis down or slow: a miss, never an error
            log.warning("query cache read failed: %s", type(e).__name__)
            return None
    else:
        with _lock:
            raw = _local.get(k)
            if raw is not None:
                _local.move_to_end(k)
    return None if raw is None else json.loads(raw)


def _set(k: str, value: Any) -> None:
    raw = json.dumps(value, default=str, separators=(",", ":"))
    r = _client()
    if r is not None:
        try:
            r.set(k, raw, ex=TTL_SECONDS)
        except Exception as e:
            log.warning("query cache write failed: %s", type(e).__name__)
        return
    with _lock:
        _local[k] = raw
        _local.move_to_end(k)
        while len(_local) > MAX_LOCAL_ENTRIES:
            _local.popitem(last=False)


def cached(k: str, compute: Callable[[], list], kind: str) -> list:
    """The cached value for `k`, or compute it and keep it (when it's small enough)."""
    hit = _get(k)
    if hit is not None:
        count("vyuham.cache", kind=kind, outcome="hit")
        return hit
    count("vyuham.cache", kind=kind, outcome="miss")
    value = compute()
    if len(value) <= MAX_CACHED_ROWS:
        _set(k, value)
    return value


def clear() -> None:
    """Empty the in-process cache (tests)."""
    with _lock:
        _local.clear()
