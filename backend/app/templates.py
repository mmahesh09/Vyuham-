"""Ready-made dashboards: Startup metrics, Sales, Expenses.

A template names the fields it needs ("amount: number") and lists chart specs that use
`{field}` placeholders. Applying it maps the user's columns to those fields; charts that
need an optional field the user didn't map are skipped. Mapping suggestions are rules only.
"""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass

from app.models import Dataset

TYPES_FOR = {"number": {"number"}, "date": {"date"}, "category": {"category", "text"}}


@dataclass(frozen=True)
class TField:
    key: str
    label: str
    type: str  # number | date | category
    hint: str  # regex matched against column names
    required: bool = True
    help: str = ""


def _m(field: str, agg: str = "sum") -> dict:
    return {"field": f"{{{field}}}", "agg": agg}


TEMPLATES: dict[str, dict] = {
    "sales": {
        "name": "Sales",
        "description": "Revenue trend, best products and customers, average order.",
        "fields": [
            TField("date", "Order date", "date", r"date|day|time|created|ordered"),
            TField("amount", "Sale amount", "number", r"amount|revenue|sales|total|price|value"),
            TField("product", "Product", "category", r"product|item|sku|plan|service|category", False),
            TField("customer", "Customer", "category", r"customer|client|account|company|buyer", False),
            TField("region", "Region or channel", "category", r"region|country|city|state|channel|source|store", False),
        ],
        "charts": [
            ("kpi", {"title": "Revenue", "chartType": "kpi", "metrics": [_m("amount")]}),
            ("kpi", {"title": "Orders", "chartType": "kpi", "metrics": [{"field": "*", "agg": "count"}]}),
            ("kpi", {"title": "Average order", "chartType": "kpi", "metrics": [_m("amount", "avg")]}),
            ("kpi", {"title": "Customers", "chartType": "kpi", "metrics": [_m("customer", "count_distinct")]}),
            ("card", {"title": "Revenue over time", "chartType": "line", "metrics": [_m("amount")], "groupBy": "{date}", "dateBucket": "month"}),
            ("card", {"title": "Revenue by product", "chartType": "bar", "metrics": [_m("amount")], "groupBy": "{product}", "limit": 10}),
            ("card", {"title": "Top customers", "chartType": "bar", "metrics": [_m("amount")], "groupBy": "{customer}", "limit": 10}),
            ("card", {"title": "Revenue by region", "chartType": "pie", "metrics": [_m("amount")], "groupBy": "{region}", "limit": 8}),
        ],
        "filters": ["region", "product"],
    },
    "startup": {
        "name": "Startup metrics",
        "description": "MRR and growth month over month, burn, and paying customers.",
        "fields": [
            TField("date", "Month or date", "date", r"date|month|period|day"),
            TField("revenue", "Revenue / MRR", "number", r"mrr|revenue|income|sales|amount"),
            TField("expenses", "Expenses / burn", "number", r"expense|cost|burn|spend|outflow", False),
            TField("customer", "Customer", "category", r"customer|client|account|company|subscriber", False),
            TField("plan", "Plan", "category", r"plan|tier|product|package", False),
        ],
        "charts": [
            ("kpi", {"title": "Revenue (MRR)", "chartType": "kpi", "metrics": [_m("revenue")]}),
            ("kpi", {"title": "Burn", "chartType": "kpi", "metrics": [_m("expenses")]}),
            ("kpi", {"title": "Paying customers", "chartType": "kpi", "metrics": [_m("customer", "count_distinct")]}),
            ("card", {"title": "MRR growth", "chartType": "area", "metrics": [_m("revenue")], "groupBy": "{date}", "dateBucket": "month"}),
            ("card", {"title": "Burn per month", "chartType": "bar", "metrics": [_m("expenses")], "groupBy": "{date}", "dateBucket": "month", "sort": "label"}),
            ("card", {"title": "Customers per month", "chartType": "line", "metrics": [_m("customer", "count_distinct")], "groupBy": "{date}", "dateBucket": "month"}),
            ("card", {"title": "Revenue by plan", "chartType": "pie", "metrics": [_m("revenue")], "groupBy": "{plan}"}),
        ],
        "filters": ["plan"],
    },
    "expenses": {
        "name": "Expenses",
        "description": "Where the money goes: by category and vendor, month over month.",
        "fields": [
            TField("date", "Date", "date", r"date|day|paid|spent|created"),
            TField("amount", "Amount", "number", r"amount|cost|total|spend|value|price"),
            TField("category", "Category", "category", r"category|type|account|department|head|class", True),
            TField("vendor", "Vendor", "category", r"vendor|supplier|payee|merchant|paid to", False),
        ],
        "charts": [
            ("kpi", {"title": "Total spend", "chartType": "kpi", "metrics": [_m("amount")]}),
            ("kpi", {"title": "Average expense", "chartType": "kpi", "metrics": [_m("amount", "avg")]}),
            ("kpi", {"title": "Vendors", "chartType": "kpi", "metrics": [_m("vendor", "count_distinct")]}),
            ("card", {"title": "Spend by category", "chartType": "bar", "metrics": [_m("amount")], "groupBy": "{category}", "limit": 12}),
            ("card", {"title": "Spend over time", "chartType": "line", "metrics": [_m("amount")], "groupBy": "{date}", "dateBucket": "month"}),
            ("card", {"title": "Top vendors", "chartType": "bar", "metrics": [_m("amount")], "groupBy": "{vendor}", "limit": 10}),
            ("card", {"title": "Category share", "chartType": "pie", "metrics": [_m("amount")], "groupBy": "{category}", "limit": 8}),
        ],
        "filters": ["category", "vendor"],
    },
}


class TemplateError(ValueError):
    pass


def public_template(key: str) -> dict:
    t = TEMPLATES[key]
    return {
        "id": key,
        "name": t["name"],
        "description": t["description"],
        "fields": [f.__dict__ for f in t["fields"]],
        "charts": [spec["title"] for _, spec in t["charts"]],
    }


def suggest_mapping(key: str, dataset: Dataset) -> dict[str, str | None]:
    """Best column per field: right type first, then a name that matches the field's hint."""
    used: set[str] = set()
    out: dict[str, str | None] = {}
    for f in TEMPLATES[key]["fields"]:
        ok = [c for c in dataset.columns if c["type"] in TYPES_FOR[f.type] and c["name"] not in used]
        named = [c for c in ok if re.search(f.hint, c["name"], re.I)]
        pick = (named or (ok if f.required else []))[:1]
        out[f.key] = pick[0]["name"] if pick else None
        if pick:
            used.add(pick[0]["name"])
    return out


def _fill(value, mapping: dict[str, str]):
    if isinstance(value, str):
        m = re.fullmatch(r"\{(\w+)\}", value)
        return mapping.get(m[1]) if m else value
    if isinstance(value, list):
        return [_fill(v, mapping) for v in value]
    if isinstance(value, dict):
        return {k: _fill(v, mapping) for k, v in value.items()}
    return value


def _needs(spec: dict) -> set[str]:
    return set(re.findall(r"\{(\w+)\}", str(spec)))


def build(key: str, dataset: Dataset, mapping: dict[str, str | None]) -> tuple[list[tuple[str, dict]], dict, list[str]]:
    """Validate the mapping and return (charts, date_fields, filter_columns)."""
    if key not in TEMPLATES:
        raise TemplateError("Unknown template")
    t = TEMPLATES[key]
    cols = {c["name"]: c["type"] for c in dataset.columns}
    clean: dict[str, str] = {}
    for f in t["fields"]:
        col = mapping.get(f.key)
        if not col:
            if f.required:
                raise TemplateError(f"Pick a column for “{f.label}”.")
            continue
        if col not in cols:
            raise TemplateError(f"“{col}” isn't a column in {dataset.name}.")
        if cols[col] not in TYPES_FOR[f.type]:
            raise TemplateError(f"“{f.label}” needs a {f.type} column; “{col}” is {cols[col]}.")
        clean[f.key] = col
    charts = []
    for kind, spec in t["charts"]:
        if not _needs(spec) <= set(clean):
            continue  # an optional field wasn't mapped
        s = _fill(copy.deepcopy(spec), clean)
        s.update(dataset=dataset.id, filters=[])
        charts.append((kind, s))
    date_fields = {dataset.id: clean["date"]} if "date" in clean else {}
    filters = [clean[k] for k in t.get("filters", []) if k in clean]
    return charts, date_fields, filters
