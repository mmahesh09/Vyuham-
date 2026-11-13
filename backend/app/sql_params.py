"""SQL Lab query parameters: `{{name}}` placeholders that become bound parameters.

A query like `SELECT * FROM sales WHERE region = {{region}} AND day >= {{since}}` is sent with
values for `region` and `since`. Each placeholder is replaced with `?` and its value is passed
to DuckDB as a bound parameter, so values are never pasted into the SQL text.

Each value has a type (text, number or date) so comparisons work against typed columns.
A placeholder written inside a quoted string ('{{x}}') is replaced too; don't do that.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any

from app.query import QueryError
from app.schemas import SqlParam as Param

PARAM_RE = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,39})\s*\}\}")
MAX_PARAMS = 20


def param_names(sql: str) -> list[str]:
    """Placeholder names in order of first use."""
    return list(dict.fromkeys(PARAM_RE.findall(sql)))


def _coerce(p: Param) -> Any:
    raw = p.value.strip()
    if raw == "":
        raise QueryError(f'Fill in a value for {{{{{p.name}}}}}.')
    if p.type == "number":
        try:
            n = float(raw.replace(",", ""))
        except ValueError:
            raise QueryError(f'{{{{{p.name}}}}} should be a number, not "{raw}".') from None
        return int(n) if n.is_integer() and "." not in raw else n
    if p.type == "date":
        try:
            return date.fromisoformat(raw)
        except ValueError:
            raise QueryError(f'{{{{{p.name}}}}} should be a date like 2026-01-31, not "{raw}".') from None
    return p.value


def bind(sql: str, params: list[Param] | None) -> tuple[str, list[Any]]:
    """(SQL with `?` placeholders, values in placeholder order). Raises QueryError for missing values."""
    names = param_names(sql)
    if not names:
        return sql, []
    if len(names) > MAX_PARAMS:
        raise QueryError(f"A query can have at most {MAX_PARAMS} parameters.")
    by_name = {p.name: p for p in params or []}
    values = {n: _coerce(by_name.get(n) or Param(name=n)) for n in names}
    ordered: list[Any] = []

    def sub(m: re.Match) -> str:
        ordered.append(values[m.group(1)])
        return "?"

    return PARAM_RE.sub(sub, sql), ordered
