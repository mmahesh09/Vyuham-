"""Remove secrets and personal data from error text before it is stored, embedded or sent to Claude.

Applied to everything that enters the engine: error messages, questions, diagnostics, SQL. The goal
is "nothing a customer would mind another person or an AI provider seeing": credentials, tokens,
contact details and the literal values in their data. Structure (column names, error wording) stays,
because that is what makes an error diagnosable.
"""

from __future__ import annotations

import re
from typing import Any

MAX_DEPTH = 6
MAX_LIST = 50
MAX_STRING = 2000

_RULES: list[tuple[re.Pattern[str], str]] = [
    # Credentials and tokens first, before more generic rules eat parts of them.
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S), "[private-key]"),
    (re.compile(r"\b[a-z][a-z0-9+.-]*://[^\s:/@]+:[^\s@/]+@", re.I), "[url-with-credentials]://"),  # scheme://user:pass@
    (re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"), "[jwt]"),
    (re.compile(r"\b(sk|pk|rk)[-_](live|test|ant|proj)?[-_]?[A-Za-z0-9_-]{16,}\b"), "[api-key]"),
    (re.compile(r"\b(AKIA|ASIA)[A-Z0-9]{16}\b"), "[aws-key]"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"), "[github-token]"),
    (re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b"), "[slack-token]"),
    (re.compile(r"\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}", re.I), r"\1 [token]"),
    (
        re.compile(r"(?i)\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|auth|authorization|cookie|session(?:id)?|private[_-]?key)\b(\s*[:=]\s*|\s+is\s+)(\"[^\"]*\"|'[^']*'|[^\s,;&]+)"),
        r"\1\2[redacted]",
    ),
    (re.compile(r"(?i)([?&](?:token|code|key|secret|signature|sig|password|auth|session)=)[^&\s#]+"), r"\1[redacted]"),
    # Personal data.
    (re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I), "[email]"),
    (re.compile(r"\b(?:\d[ -]?){13,19}\b"), "[card-or-account-number]"),
    (re.compile(r"(?<![\w.])\+\d[\d ()-]{7,}\d(?![\w.])"), "[phone]"),  # international: +44 20 7946 0958
    (re.compile(r"(?<![\w.-])\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?![\w.-])"), "[phone]"),  # (555) 123-4567, 555.123.4567
    (re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"), "[ip]"),
    # Share and invite links carry secrets in the path.
    (re.compile(r"/(s|invite)/[A-Za-z0-9_-]{8,}"), r"/\1/[token]"),
    # Long opaque strings (hex ids, base64 blobs) rarely help diagnosis and can be secrets.
    (re.compile(r"\b[A-Fa-f0-9]{32,}\b"), "[hex]"),
    (re.compile(r"\b[A-Za-z0-9+/]{40,}={0,2}"), "[blob]"),
]

# Literal values inside error messages from the query engine, e.g. Conversion Error: "abc" or 'abc'.
_QUOTED = re.compile(r"'(?:[^'\\]|\\.){0,200}'|\"(?:[^\"\\]|\\.){0,200}\"")


def redact_text(text: str | None, *, mask_quoted: bool = False) -> str:
    """Redact one string. `mask_quoted` also replaces quoted literals (for database error messages)."""
    if not text:
        return ""
    out = str(text)[: MAX_STRING * 2]
    for pattern, repl in _RULES:
        out = pattern.sub(repl, out)
    if mask_quoted:
        out = _QUOTED.sub(lambda m: m.group(0)[0] + "?" + m.group(0)[0], out)
    return out[:MAX_STRING]


_SQL_STRING = re.compile(r"'(?:[^']|'')*'")
_SQL_NUMBER = re.compile(r"(?<![\w.\"])-?\d+(?:\.\d+)?(?![\w.\"])")


def redact_sql(sql: str | None) -> str:
    """Keep a query's shape (tables, columns, functions) and replace every literal value with `?`."""
    if not sql:
        return ""
    out = _SQL_STRING.sub("'?'", str(sql)[:10_000])
    out = _SQL_NUMBER.sub("?", out)
    return redact_text(out)


_SECRET_KEY = re.compile(r"(?i)pass|secret|token|auth|cookie|session|api[-_]?key|credential|private|signature|email|phone|dsn|conn")


def redact_value(value: Any, *, depth: int = 0) -> Any:
    """Redact a JSON-like structure. Keys that look secret are dropped to '[redacted]'; sizes are capped."""
    if depth > MAX_DEPTH:
        return "[truncated]"
    if isinstance(value, str):
        return redact_text(value, mask_quoted=True)
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, (list, tuple)):
        return [redact_value(v, depth=depth + 1) for v in list(value)[:MAX_LIST]]
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in list(value.items())[:MAX_LIST]:
            key = str(k)[:80]
            if key.lower() == "sql" and isinstance(v, str):
                out[key] = redact_sql(v)
            elif _SECRET_KEY.search(key):
                out[key] = "[redacted]"
            else:
                out[key] = redact_value(v, depth=depth + 1)
        return out
    return redact_text(str(value))
