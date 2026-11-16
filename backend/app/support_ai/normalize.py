"""Normalize errors into a stable template, categorize them, and fingerprint duplicates.

The fingerprint must be the same for "the same problem" regardless of which ids, numbers, names or
values appear in one occurrence, and must never be derived from tenant data. It is computed from
module + category + error type + the normalized template, which contains only error wording.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

MODULES = ("sql_lab", "dashboard", "automations", "reports", "datasets", "alerts", "auth", "other")

# Order matters: the first matching rule wins.
_CATEGORY_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("sql_syntax", re.compile(r"syntax error|parser error|unexpected (token|end)|at or near", re.I)),
    ("sql_unknown_column", re.compile(r"(column|field|referenced column).*(not found|does not exist|unknown)|binder error.*column", re.I)),
    ("sql_unknown_table", re.compile(r"(table|relation|catalog).*(not found|does not exist|unknown)", re.I)),
    ("sql_type_mismatch", re.compile(r"conversion error|could not convert|cannot cast|type mismatch|invalid input syntax", re.I)),
    ("sql_not_allowed", re.compile(r"read-only|only select|not allowed|permission denied for", re.I)),
    ("query_timeout", re.compile(r"timed? ?out|timeout|took too long|interrupted", re.I)),
    ("query_too_large", re.compile(r"too many rows|row limit|out of memory|too large", re.I)),
    ("chart_config", re.compile(r"chart|metric|group ?by|aggregat|measure|dimension", re.I)),
    ("dataset_missing", re.compile(r"dataset.*(deleted|missing|not found)|no such dataset", re.I)),
    ("upload_parse", re.compile(r"could not (read|parse)|unsupported file|invalid (csv|excel|file)|encoding|header row", re.I)),
    ("delivery_failed", re.compile(r"webhook|smtp|email.*(fail|refus|bounce)|delivery|http \d{3}", re.I)),
    ("schedule_invalid", re.compile(r"timezone|cron|schedule", re.I)),
    ("permission", re.compile(r"forbidden|not allowed|owners and editors|permission|unauthori[sz]ed|403", re.I)),
    ("auth", re.compile(r"sign(ed)? ?in|session expired|not signed in|401|login", re.I)),
    ("network", re.compile(r"network|fetch failed|failed to fetch|connection (refused|reset)|unreachable|dns", re.I)),
    ("server_error", re.compile(r"internal server error|\b5\d\d\b|unexpected error|something went wrong", re.I)),
]

_NORMALIZERS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\[(email|jwt|api-key|token|redacted|hex|blob|ip|phone|card-or-account-number|private-key|aws-key|github-token|slack-token|url-with-credentials)\]"), "<redacted>"),
    (re.compile(r"'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\""), "<str>"),
    (re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I), "<uuid>"),
    (re.compile(r"\b\d{4}-\d{2}-\d{2}([ t]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(z|[+-]\d{2}:?\d{2})?\b", re.I), "<date>"),
    (re.compile(r"\b\d+(\.\d+)?\b"), "<n>"),
    (re.compile(r"\bline <n>(, column <n>)?"), "line <n>"),
    (re.compile(r"\s+"), " "),
]


@dataclass(frozen=True)
class NormalizedError:
    module: str
    category: str
    error_type: str
    template: str
    fingerprint: str


def normalize_message(message: str) -> str:
    out = (message or "").strip().lower()
    for pattern, repl in _NORMALIZERS:
        out = pattern.sub(repl, out)
    return out.strip()[:500]


def categorize(module: str, message: str, http_status: int | None = None) -> str:
    for category, pattern in _CATEGORY_RULES:
        if pattern.search(message or ""):
            return category
    if http_status is not None:
        if http_status in (401,):
            return "auth"
        if http_status == 403:
            return "permission"
        if http_status >= 500:
            return "server_error"
    return {"sql_lab": "sql_other", "dashboard": "chart_config", "automations": "automation_failed", "reports": "report_failed"}.get(module, "other")


def clean_error_type(error_type: str | None) -> str:
    """'QueryError', 'TypeError', 'HTTP 422'... reduced to a short safe token."""
    return re.sub(r"[^A-Za-z0-9_. -]", "", (error_type or "Error"))[:120].strip() or "Error"


def fingerprint(module: str, category: str, error_type: str, template: str) -> str:
    raw = "\x1f".join([module, category, error_type.lower(), template])
    return hashlib.sha256(raw.encode()).hexdigest()


def normalize(module: str, message_redacted: str, error_type: str | None = None, http_status: int | None = None) -> NormalizedError:
    """`message_redacted` must already have gone through redact.redact_text."""
    module = module if module in MODULES else "other"
    etype = clean_error_type(error_type or (f"HTTP {http_status}" if http_status else None))
    template = normalize_message(message_redacted)
    category = categorize(module, message_redacted, http_status)
    return NormalizedError(module, category, etype, template, fingerprint(module, category, etype, template))
