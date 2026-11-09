"""Rule-based "ask your data" (no AI yet): a plain-English question -> a chart spec.

It matches words to column names and a few synonyms, picks the measure, grouping, date
bucket and range, then runs the spec through the normal query engine. When it can't map a
question it says so and offers questions it can answer, instead of guessing.
The AI round will replace `parse_question` and keep everything after it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta

import duckdb

from app.insights import AMOUNT_HINT, ENTITY_HINT, ID_HINT, metric_label
from app.models import Dataset
from app.query import ROW_KEY, Filters, distinct_values

WORD = re.compile(r"[a-z0-9]+")
COUNT_WORDS = {"orders", "order", "transactions", "transaction", "rows", "records", "sales_count", "deals", "invoices", "count", "number"}
AMOUNT_WORDS = {"revenue", "sales", "income", "amount", "money", "turnover", "value", "earnings", "spend", "spending", "cost", "costs"}
AGG_WORDS = {
    "average": "avg", "avg": "avg", "mean": "avg", "typical": "avg",
    "total": "sum", "sum": "sum", "overall": "sum",
    "highest": "max", "biggest": "max", "largest": "max", "maximum": "max", "max": "max", "peak": "max",
    "lowest": "min", "smallest": "min", "minimum": "min", "min": "min",
}
BUCKET_WORDS = {
    "daily": "day", "day": "day", "days": "day", "weekly": "week", "week": "week", "weeks": "week",
    "monthly": "month", "month": "month", "months": "month", "quarterly": "quarter", "quarter": "quarter", "quarters": "quarter",
    "yearly": "year", "annual": "year", "annually": "year", "year": "year", "years": "year",
}
TREND_WORDS = {"trend", "over", "time", "growth", "grow", "growing", "history", "timeline"}
SHARE_WORDS = {"share", "split", "breakdown", "percent", "percentage", "mix", "proportion"}
STOP = {"the", "a", "an", "of", "in", "for", "by", "per", "each", "what", "whats", "is", "are", "was", "were", "show", "me", "how",
        "much", "many", "did", "do", "we", "our", "my", "to", "and", "with", "from", "this", "last", "top", "bottom", "which", "who"}


@dataclass
class Parsed:
    dataset: Dataset
    spec: dict
    filters: Filters | None
    understood: list[str] = field(default_factory=list)  # human-readable bits we picked up
    score: int = 0


def words(text: str) -> list[str]:
    return WORD.findall(text.lower())


def singular(w: str) -> str:
    return w[:-3] + "y" if w.endswith("ies") else w[:-1] if w.endswith("s") and len(w) > 3 else w


def column_words(name: str) -> set[str]:
    return {singular(w) for w in words(name)}


def _match_column(tokens: list[str], columns: list[dict], types: set[str]) -> str | None:
    """The column whose name shares the most words with the question (ties: shortest name)."""
    toks = {singular(t) for t in tokens} - STOP
    best, best_score = None, 0
    for c in columns:
        if c["type"] not in types:
            continue
        score = len(column_words(c["name"]) & toks)
        if score > best_score or (score == best_score and score and best and len(c["name"]) < len(best)):
            best, best_score = c["name"], score
    return best


def _date_range(text: str, today: date) -> tuple[date, date, str] | None:
    t = text.lower()
    m = re.search(r"(?:last|past|previous)\s+(\d{1,3})\s+(day|week|month)s?", t)
    if m:
        n, unit = int(m[1]), m[2]
        days = n * {"day": 1, "week": 7, "month": 30}[unit]
        return today - timedelta(days=days - 1), today, f"last {n} {unit}{'s' if n > 1 else ''}"
    if "today" in t:
        return today, today, "today"
    if "yesterday" in t:
        y = today - timedelta(days=1)
        return y, y, "yesterday"
    q_start = date(today.year, 3 * ((today.month - 1) // 3) + 1, 1)
    first = today.replace(day=1)
    ranges = {
        "this week": (today - timedelta(days=today.weekday()), today),
        "last week": (today - timedelta(days=today.weekday() + 7), today - timedelta(days=today.weekday() + 1)),
        "this month": (first, today),
        "last month": ((first - timedelta(days=1)).replace(day=1), first - timedelta(days=1)),
        "this quarter": (q_start, today),
        "last quarter": (date(q_start.year if q_start.month > 3 else q_start.year - 1, (q_start.month - 4) % 12 + 1, 1), q_start - timedelta(days=1)),
        "this year": (date(today.year, 1, 1), today),
        "ytd": (date(today.year, 1, 1), today),
        "last year": (date(today.year - 1, 1, 1), date(today.year - 1, 12, 31)),
    }
    for phrase, (lo, hi) in ranges.items():
        if phrase in t:
            return lo, hi, phrase
    m = re.search(r"\b(20\d{2})\b", t)
    if m:
        y = int(m[1])
        return date(y, 1, 1), date(y, 12, 31), str(y)
    return None


def _parse_one(question: str, ds: Dataset, con: duckdb.DuckDBPyConnection, today: date) -> Parsed:
    tokens = words(question)
    tokset = set(tokens)
    cols = ds.columns
    numbers = [c for c in cols if c["type"] == "number" and not ID_HINT.search(c["name"])]
    dates = [c["name"] for c in cols if c["type"] == "date"]
    groupable = [c for c in cols if c["type"] in ("category", "text")]
    understood: list[str] = []
    score = 0

    # Measure
    named_number = _match_column(tokens, numbers, {"number"})
    agg = next((AGG_WORDS[t] for t in tokens if t in AGG_WORDS), None)
    count_q = bool({"many", "count", "number"} & tokset) or bool(COUNT_WORDS & tokset and not named_number and not AMOUNT_WORDS & tokset)
    distinct_col = None
    if ("how" in tokset and "many" in tokset) or "unique" in tokset or "distinct" in tokset:
        cand = _match_column(tokens, groupable, {"category", "text"})
        if cand and not re.search(r"\b(by|per|each)\s+" + re.escape(cand.lower()), question.lower()):
            distinct_col = cand
    if named_number:
        metric = {"field": named_number, "agg": agg or "sum"}
        score += 3
    elif distinct_col:
        metric = {"field": distinct_col, "agg": "count_distinct"}
        score += 3
    elif count_q:
        metric = {"field": ROW_KEY, "agg": "count"}
        score += 2
    elif AMOUNT_WORDS & tokset and numbers:
        hinted = next((c["name"] for c in numbers if AMOUNT_HINT.search(c["name"])), numbers[0]["name"])
        metric = {"field": hinted, "agg": agg or "sum"}
        score += 2
    elif numbers:
        hinted = next((c["name"] for c in numbers if AMOUNT_HINT.search(c["name"])), numbers[0]["name"])
        metric = {"field": hinted, "agg": agg or "sum"}
    else:
        metric = {"field": ROW_KEY, "agg": "count"}
    understood.append(metric_label(metric))

    # Grouping: explicit "by/per X", "top N X", a time bucket, or a trend word
    spec: dict = {"dataset": ds.id, "metrics": [metric], "filters": [], "chartType": "kpi"}
    group = None
    m = re.search(r"\b(?:by|per|each|across)\s+([a-z0-9 _&-]+)", question.lower())
    if m:
        group = _match_column(words(m[1])[:3], groupable + [c for c in cols if c["type"] == "date"], {"category", "text", "date"})
    top = re.search(r"\b(top|bottom|best|worst)\s+(\d{1,3})?", question.lower())
    if top and not group:
        after = question.lower()[top.end():]
        group = _match_column(words(after)[:3], groupable, {"category", "text"}) or next(
            (c["name"] for c in groupable if ENTITY_HINT.search(c["name"])), None
        )
    # "monthly" / "by month" / "per week" pick a time bucket; "last 3 months" is a range, not a bucket.
    adverb = next((BUCKET_WORDS[t] for t in tokens if t in {"daily", "weekly", "monthly", "quarterly", "yearly", "annual", "annually"}), None)
    phrase = re.search(r"\b(?:by|per|each|every)\s+(day|week|month|quarter|year)\b", question.lower())
    bucket = adverb or (BUCKET_WORDS[phrase[1]] if phrase else None)
    if not group and dates and (bucket or TREND_WORDS & tokset):
        group = dates[0]
    if group:
        score += 2
        spec["groupBy"] = group
        if group in dates:
            spec["dateBucket"] = bucket or "month"
            spec["chartType"] = "line"
            understood.append(f"per {spec['dateBucket']}")
        else:
            spec["chartType"] = "pie" if SHARE_WORDS & tokset else "bar"
            understood.append(f"by {group}")
            if top:
                n = int(top[2]) if top[2] else 5
                spec["limit"] = n
                spec["sort"] = "value_asc" if top[1] in ("bottom", "worst") else "value_desc"
                understood.append(f"{top[1]} {n}")

    # Values mentioned in the question ("in North", "for Acme")
    for c in groupable:
        if c["name"] == group:
            continue
        try:
            values = distinct_values(con, ds, c["name"], limit=200)
        except Exception:
            continue
        q = f" {question.lower()} "
        hit = next((v for v in sorted(values, key=len, reverse=True) if len(v) >= 2 and f" {v.lower()} " in q), None)
        if hit:
            spec["filters"].append({"field": c["name"], "op": "eq", "value": hit})
            understood.append(f"{c['name']} = {hit}")
            score += 2

    # Date range
    filters = None
    rng = _date_range(question, today)
    if rng and dates:
        lo, hi, label = rng
        filters = Filters(dates[0], lo, hi)
        understood.append(label)
        score += 1

    title_bits = [metric_label(metric)]
    if group:
        title_bits.append("over time" if group in dates else f"by {group}")
    spec["title"] = " ".join(title_bits)[:200]
    return Parsed(ds, spec, filters, understood, score)


def parse_question(question: str, datasets: list[Dataset], con: duckdb.DuckDBPyConnection, today: date | None = None) -> Parsed | None:
    """Best interpretation across the workspace's datasets, or None if nothing matched."""
    today = today or date.today()
    best: Parsed | None = None
    for ds in datasets:
        p = _parse_one(question, ds, con, today)
        # Prefer the dataset whose columns the question actually names.
        p.score += len({singular(t) for t in words(question)} & set().union(*(column_words(c["name"]) for c in ds.columns)))
        if best is None or p.score > best.score:
            best = p
    if best is None or best.score < 2:
        return None
    return best


def suggestions(datasets: list[Dataset], limit: int = 6) -> list[str]:
    """Questions this parser can answer for the user's own columns."""
    out: list[str] = []
    for ds in datasets:
        numbers = [c["name"] for c in ds.columns if c["type"] == "number" and not ID_HINT.search(c["name"])]
        cats = [c["name"] for c in ds.columns if c["type"] == "category"]
        dates = [c["name"] for c in ds.columns if c["type"] == "date"]
        amount = next((n for n in numbers if AMOUNT_HINT.search(n)), numbers[0] if numbers else None)
        entity = next((c for c in cats if ENTITY_HINT.search(c)), None)
        if amount and dates:
            out.append(f"{amount} by month")
            out.append(f"Total {amount} this year")
        if amount and entity:
            out.append(f"Top 5 {entity} by {amount}")
        for c in cats[:2]:
            if c != entity and amount:
                out.append(f"{amount} by {c}")
        if dates:
            out.append("How many rows this month")
        if entity:
            out.append(f"How many unique {entity}")
    return list(dict.fromkeys(out))[:limit]
