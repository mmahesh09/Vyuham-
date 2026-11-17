"""Join hints for SQL Lab: which columns in different datasets look like the same thing.

Two steps, both inside the workspace's sandboxed DuckDB:
1. Names: columns whose names mean the same ("customer" ~ "client" ~ "company_name", "order_id" ~ "order")
   and whose types can be compared.
2. Evidence: for those candidates, how many distinct values actually overlap (up to 10,000 per side), and
   whether each side is unique (one-to-one, one-to-many...).

Only counts and percentages leave this module, never the values themselves. Results are cached per
workspace until a dataset changes.
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import asdict, dataclass

import duckdb

from app.ask import column_words
from app.models import Dataset
from app.query import _run, connect, quote, table_names, view_name
from app.telemetry import span

MIN_OVERLAP = 0.3
SAMPLE = 10_000
MAX_CANDIDATES = 40
MAX_HINTS = 20

# Words that name the same kind of thing in small-business spreadsheets.
SYNONYMS = [
    {"customer", "client", "company", "account", "buyer", "organisation", "organization", "org"},
    {"product", "item", "sku", "article"},
    {"order", "invoice", "sale", "transaction", "purchase"},
    {"supplier", "vendor"},
    {"employee", "staff", "member", "user", "rep", "owner"},
    {"country", "nation"},
    {"city", "town"},
    {"region", "area", "territory", "zone"},
    {"campaign", "channel", "source"},
]
CANON = {w: sorted(group)[0] for group in SYNONYMS for w in group}
# Words that say what kind of value a column holds, not what it is about.
GENERIC = {"id", "name", "code", "no", "number", "num", "key", "ref", "reference", "value", "label"}
ID_WORDS = {"id", "code", "no", "number", "num", "key", "ref", "sku"}


@dataclass(frozen=True)
class JoinHint:
    left_table: str
    left_column: str
    right_table: str
    right_column: str
    overlap: float  # share of the smaller side's distinct values found on the other side, 0-1
    normalized: bool  # True when values only match after lower-casing and trimming
    cardinality: str  # one_to_one | one_to_many | many_to_one | many_to_many
    sql: str  # a ready JOIN clause

    def as_dict(self) -> dict:
        return asdict(self)


def _core(name: str) -> set[str]:
    return {CANON.get(w, w) for w in column_words(name)} - GENERIC


def name_score(a: str, b: str) -> float:
    """How strongly two column names suggest the same thing (0 = not at all)."""
    if a.strip().lower() == b.strip().lower():
        return 1.0
    core_a, core_b = _core(a), _core(b)
    if not core_a or not core_b:
        return 0.0
    shared = core_a & core_b
    if not shared:
        return 0.0
    return 0.5 + 0.4 * len(shared) / max(len(core_a | core_b), 1)


def _comparable(a: dict, b: dict) -> bool:
    text = {"category", "text"}
    if a["type"] in text and b["type"] in text:
        return True
    # Numbers only when both look like identifiers (order_id ~ order_no), never amounts.
    if a["type"] == "number" and b["type"] == "number":
        return bool(column_words(a["name"]) & ID_WORDS) and bool(column_words(b["name"]) & ID_WORDS)
    return False


def candidates(datasets: list[Dataset]) -> list[tuple[float, Dataset, dict, Dataset, dict]]:
    """Column pairs across different datasets, best name match first."""
    out = []
    for i, da in enumerate(datasets):
        for db_ in datasets[i + 1 :]:
            for ca in da.columns:
                for cb in db_.columns:
                    if not _comparable(ca, cb):
                        continue
                    score = name_score(ca["name"], cb["name"])
                    if score > 0:
                        out.append((score, da, ca, db_, cb))
    out.sort(key=lambda t: -t[0])
    return out[:MAX_CANDIDATES]


def _evidence(con: duckdb.DuckDBPyConnection, da: Dataset, ca: str, db_: Dataset, cb: str) -> tuple[float, bool, str] | None:
    va, vb, qa, qb = view_name(da.id), view_name(db_.id), quote(ca), quote(cb)
    sql = f"""
        WITH a AS (SELECT DISTINCT CAST({qa} AS VARCHAR) AS v FROM {va} WHERE {qa} IS NOT NULL LIMIT {SAMPLE}),
             b AS (SELECT DISTINCT CAST({qb} AS VARCHAR) AS v FROM {vb} WHERE {qb} IS NOT NULL LIMIT {SAMPLE}),
             an AS (SELECT DISTINCT lower(trim(v)) AS v FROM a),
             bn AS (SELECT DISTINCT lower(trim(v)) AS v FROM b)
        SELECT
            (SELECT COUNT(*) FROM a), (SELECT COUNT(*) FROM b),
            (SELECT COUNT(*) FROM a JOIN b USING (v)),
            (SELECT COUNT(*) FROM an), (SELECT COUNT(*) FROM bn),
            (SELECT COUNT(*) FROM an JOIN bn USING (v)),
            (SELECT COUNT(*) = COUNT(DISTINCT {qa}) FROM {va} WHERE {qa} IS NOT NULL),
            (SELECT COUNT(*) = COUNT(DISTINCT {qb}) FROM {vb} WHERE {qb} IS NOT NULL)
    """  # quoted identifiers and server-built view names only  # nosec B608
    _, rows = _run(con, sql, [], op="joins")
    na, nb, exact, nna, nnb, norm, unique_a, unique_b = rows[0]
    if not na or not nb:
        return None
    exact_share = exact / min(na, nb)
    norm_share = norm / min(nna, nnb) if nna and nnb else 0.0
    if exact_share >= MIN_OVERLAP:
        share, normalized = exact_share, False
    elif norm_share >= MIN_OVERLAP:
        share, normalized = norm_share, True
    else:
        return None
    card = {
        (True, True): "one_to_one", (True, False): "one_to_many",
        (False, True): "many_to_one", (False, False): "many_to_many",
    }[(bool(unique_a), bool(unique_b))]
    return round(share, 3), normalized, card


def find_joins(workspace_id: str, datasets: list[Dataset]) -> list[JoinHint]:
    """Join hints for a workspace, strongest first. Cached until any dataset changes."""
    key = (workspace_id, tuple(sorted((d.id, str(d.updated_at or d.created_at), d.row_count) for d in datasets)))
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    names = table_names(datasets)
    hints: list[JoinHint] = []
    pairs = candidates(datasets)
    with span("vyuham.joins", **{"vyuham.workspace_id": workspace_id, "vyuham.joins.candidates": len(pairs)}) as s:
        if pairs:
            con = connect(workspace_id, datasets)
            try:
                for _, da, ca, db_, cb in pairs:
                    try:
                        found = _evidence(con, da, ca["name"], db_, cb["name"])
                    except Exception:  # one odd column must not hide every other hint
                        continue
                    if not found:
                        continue
                    share, normalized, card = found
                    ta, tb = names[da.id], names[db_.id]
                    left, right = f"a.{quote(ca['name'])}", f"b.{quote(cb['name'])}"
                    on = f"lower(trim({left})) = lower(trim({right}))" if normalized else f"{left} = {right}"
                    hints.append(JoinHint(ta, ca["name"], tb, cb["name"], share, normalized, card,
                                          f"FROM {quote(ta)} AS a\nJOIN {quote(tb)} AS b ON {on}"))
            finally:
                con.close()
        hints.sort(key=lambda h: (-h.overlap, h.normalized))
        hints = hints[:MAX_HINTS]
        s.set_attribute("vyuham.joins.found", len(hints))
    _cache[key] = hints
    while len(_cache) > 64:
        _cache.popitem(last=False)
    return hints


_cache: OrderedDict[tuple, list[JoinHint]] = OrderedDict()


def clear_cache() -> None:
    _cache.clear()
