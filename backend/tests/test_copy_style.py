"""The sentences Vyuham writes itself stay plain: no AI tells (rules from .claude/skills/stop-slop).

Generates every insight branch (KPI, trend over a period, last two buckets, partial bucket, category
lead, concentration, empty) plus Ask's own messages, and checks each sentence.
"""

import re
from datetime import date

import pytest

from app.insights import describe
from app.models import Dataset

# Phrases from stop-slop's references/phrases.md that could plausibly creep into product copy.
BANNED = [
    "here's", "it turns out", "the truth is", "let that sink in", "make no mistake", "it's worth noting",
    "at the end of the day", "at its core", "in today's", "game-changer", "deep dive", "unpack", "navigate",
    "lean into", "landscape", "moving forward", "circle back", "a lot depends", "full stop",
]
# -ly words that are nouns/adjectives in this domain, not adverbs.
LY_ALLOWED = {"only", "monthly", "weekly", "daily", "quarterly", "yearly", "early", "family", "italy", "supply", "reply", "july"}

DS = Dataset(
    id="d",
    columns=[{"name": "Date", "type": "date"}, {"name": "Region", "type": "category"}, {"name": "Amount", "type": "number"}],
)
SUM = [{"field": "Amount", "agg": "sum"}]
MONTHS = [{"Date": "2026-08", "sum_Amount": 90}, {"Date": "2026-09", "sum_Amount": 100}, {"Date": "2026-10", "sum_Amount": 150}, {"Date": "2026-11", "sum_Amount": 20}]


def sentences() -> list[str]:
    cases = [
        # KPI: up, down, no comparison (with and without a period), empty
        ({"metrics": SUM}, [{"sum_Amount": 120}], [{"sum_Amount": 100}], True),
        ({"metrics": SUM}, [{"sum_Amount": 80}], [{"sum_Amount": 100}], True),
        ({"metrics": SUM}, [{"sum_Amount": 80}], None, False),
        ({"metrics": SUM}, [{"sum_Amount": 80}], [{"sum_Amount": None}], True),
        ({"metrics": SUM}, [], None, False),
        # Over time: vs the previous period, last two buckets, partial current bucket
        ({"metrics": SUM, "groupBy": "Date", "dateBucket": "month"}, MONTHS[:3], MONTHS[:2], True),
        ({"metrics": SUM, "groupBy": "Date", "dateBucket": "month"}, MONTHS[:3], None, False),
        ({"metrics": SUM, "groupBy": "Date", "dateBucket": "month"}, MONTHS, None, False),
        # By category: concentrated, spread out, averages
        ({"metrics": SUM, "groupBy": "Region"}, [{"Region": "North", "sum_Amount": 300}, {"Region": "South", "sum_Amount": 50}, {"Region": "West", "sum_Amount": 40}], None, False),
        ({"metrics": SUM, "groupBy": "Region"}, [{"Region": r, "sum_Amount": 100} for r in ("North", "South", "West", "East")], None, False),
        ({"metrics": [{"field": "Amount", "agg": "avg"}], "groupBy": "Region"}, [{"Region": "North", "avg_Amount": 12.5}, {"Region": "South", "avg_Amount": 9}], None, False),
    ]
    out = []
    for spec, rows, prev, has_period in cases:
        i = describe(spec, rows, prev, DS, has_period=has_period, today=date(2026, 11, 9))
        out += [s for s in (i.headline, i.note) if s]
    from app.routers import ask

    src = open(ask.__file__, encoding="utf-8").read()
    out += re.findall(r'message="([^"]+)"', src)
    return out


ALL = sentences()


def test_covers_every_branch():
    assert len(ALL) >= 20


@pytest.mark.parametrize("text", ALL)
def test_no_ai_tells(text):
    low = text.lower()
    assert "—" not in text, f"em dash in: {text}"
    assert " · " not in text, f"middle-dot joiner in: {text}"
    for phrase in BANNED:
        assert phrase not in low, f"{phrase!r} in: {text}"
    adverbs = [w for w in re.findall(r"[a-z]+ly\b", low) if w not in LY_ALLOWED]
    assert not adverbs, f"adverb {adverbs} in: {text}"
