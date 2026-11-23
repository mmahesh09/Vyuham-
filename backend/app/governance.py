"""Data governance: sensitive-data scanning, classification, masking and access control.

Enforcement lives in the query engine, not the UI. `access_for` turns a workspace's grants,
classifications and masking policies into an `Access` map for one role; `query.connect` applies it
while it builds the per-dataset views, so every query path that goes through a member-aware
connection (SQL Workbench, previews, profiles, exports, dashboards, Ask, pipelines run by a person)
sees hidden columns removed and masked columns rewritten before any row leaves DuckDB.

Owners always see everything, so a workspace can't lock itself out of its own data.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import duckdb
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AccessGrant, ColumnClassification, Dataset, GovernancePolicy, WorkspaceMember

LABELS = ("public", "internal", "confidential", "restricted")
PII_TYPES = ("email", "phone", "person_name", "address", "financial", "government_id", "sensitive")
METHODS = ("partial", "hash", "redact", "full", "hide")  # least to most restrictive
ROLES = ("owner", "editor", "viewer", "public")
_STRENGTH = {m: i for i, m in enumerate(METHODS)}


# ---------- access map ----------


@dataclass
class DatasetAccess:
    hidden: bool = False
    # column name -> masking method (partial | hash | redact | full | hide)
    columns: dict[str, str] = field(default_factory=dict)


Access = dict[str, DatasetAccess]


def _stronger(a: str | None, b: str) -> str:
    return b if a is None or _STRENGTH[b] > _STRENGTH[a] else a


def role_of(member: WorkspaceMember | None) -> str:
    return member.role if member is not None else "public"


def access_for(db: Session, workspace_id: str, role: str) -> Access:
    """What `role` may see of each dataset in the workspace. Empty for owners."""
    if role == "owner":
        return {}
    out: Access = {}
    grants = db.scalars(select(AccessGrant).where(AccessGrant.workspace_id == workspace_id, AccessGrant.role == role)).all()
    explicit_read: set[tuple[str, str]] = set()
    for g in grants:
        acc = out.setdefault(g.dataset_id, DatasetAccess())
        if g.column == "":
            if g.access == "none":
                acc.hidden = True
            elif g.access == "masked":
                acc.columns["*"] = _stronger(acc.columns.get("*"), "full")
        elif g.access == "none":
            acc.columns[g.column] = "hide"
        elif g.access == "masked":
            acc.columns[g.column] = _stronger(acc.columns.get(g.column), "full")
        else:
            explicit_read.add((g.dataset_id, g.column))

    policies = db.scalars(
        select(GovernancePolicy).where(GovernancePolicy.workspace_id == workspace_id, GovernancePolicy.kind == "masking", GovernancePolicy.enabled.is_(True))
    ).all()
    if policies:
        classes = db.scalars(
            select(ColumnClassification).where(ColumnClassification.workspace_id == workspace_id, ColumnClassification.status == "active")
        ).all()
        for c in classes:
            if (c.dataset_id, c.column) in explicit_read:
                continue
            for p in policies:
                method = policy_method(p.rules or {}, c.label, c.pii_type, role)
                if method:
                    acc = out.setdefault(c.dataset_id, DatasetAccess())
                    acc.columns[c.column] = _stronger(acc.columns.get(c.column), method)
    return out


def policy_method(rules: dict, label: str, pii_type: str | None, role: str) -> str | None:
    """The method a masking policy applies to a column with this label/type for this role, or None."""
    if role in (rules.get("exempt_roles") or []) or role == "owner":
        return None
    labels = rules.get("labels") or []
    types = rules.get("pii_types") or []
    if not ((labels and label in labels) or (types and pii_type in types)):
        return None
    method = rules.get("method", "full")
    return method if method in METHODS else "full"


def member_access(db: Session, member: WorkspaceMember | None) -> Access:
    ws = member.workspace_id if member is not None else None
    return access_for(db, ws, role_of(member)) if ws else {}


def connect_as(db: Session, member: WorkspaceMember, datasets: list[Dataset]):
    """A DuckDB connection that applies this member's access rules and masking."""
    from app.query import connect

    return connect(member.workspace_id, datasets, access=member_access(db, member))


def role_for_user(db: Session, workspace_id: str, user_id: str | None) -> str:
    """The workspace role of whoever asked for something to run later (reports); viewer when unknown."""
    if not user_id:
        return "viewer"
    role = db.scalar(select(WorkspaceMember.role).where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id))
    return role or "viewer"


def visible_datasets(db: Session, member: WorkspaceMember | None, datasets: list[Dataset], access: Access | None = None) -> list[Dataset]:
    access = member_access(db, member) if access is None else access
    return [d for d in datasets if not access.get(d.id, DatasetAccess()).hidden]


def column_method(access: Access | None, dataset_id: str, column: str) -> str | None:
    if not access:
        return None
    acc = access.get(dataset_id)
    if acc is None:
        return None
    return acc.columns.get(column) or acc.columns.get("*")


def mask_sql(expr: str, col_type: str, method: str, salt: str) -> str:
    """SQL that replaces a typed column expression with its masked form. Non-text columns become NULL
    (except hashing), so totals over a masked amount can't leak it."""
    text = col_type in ("text", "category") or col_type == ""
    salt_lit = salt.replace("'", "''")
    if method == "hash":
        return f"CASE WHEN {expr} IS NULL THEN NULL ELSE substr(sha256(CAST({expr} AS VARCHAR) || '{salt_lit}'), 1, 16) END"
    if not text:
        return f"CAST(NULL AS {'DOUBLE' if col_type == 'number' else 'TIMESTAMP' if col_type == 'date' else 'VARCHAR'})"
    v = f"CAST({expr} AS VARCHAR)"
    if method == "partial":
        return (
            f"CASE WHEN {expr} IS NULL THEN NULL WHEN contains({v}, '@') THEN left({v}, 1) || '***@' || split_part({v}, '@', 2) "
            f"ELSE repeat('*', greatest(length({v}) - 4, 0)) || right({v}, 4) END"
        )
    if method == "redact":
        return f"CASE WHEN {expr} IS NULL THEN NULL ELSE '[REDACTED]' END"
    return f"CASE WHEN {expr} IS NULL THEN NULL ELSE '••••••' END"


# ---------- scanner ----------

_NAME_HINTS: list[tuple[str, re.Pattern]] = [
    ("email", re.compile(r"e[-_ ]?mail")),
    ("phone", re.compile(r"phone|mobile|cell|tel(ephone)?\b|whatsapp")),
    ("government_id", re.compile(r"ssn|social_?security|aadhaa?r|\bpan\b|pan_?(no|number|card)|passport|national_?id|tax_?id|\btin\b|\bnin\b|driv(er|ing)_?licen[cs]e")),
    ("financial", re.compile(r"card_?(no|number|num)|credit_?card|\bccn?\b|iban|account_?(no|number|num)|routing|swift|\bifsc\b|bank_?account|salary|\bcvv\b")),
    ("person_name", re.compile(r"(^|_)(first|last|full|middle|given|sur|family|customer|contact|employee|user)?_?name$|^name$")),
    ("address", re.compile(r"address|street|\bzip\b|zip_?code|postal|postcode|\bcity\b|addr")),
    ("sensitive", re.compile(r"\bdob\b|birth|gender|\bsex\b|religion|ethnic|race|health|medical|diagnos|disab|caste|sexual|password|secret|token")),
]
# Columns that look like names by pattern but rarely hold people ("product_name", "file_name").
_NOT_PEOPLE = re.compile(r"product|item|file|company|brand|category|plan|sku|region|country|state|city|store|campaign|project|table|column|dataset|event|page|host|domain|team|department|job|role")

_VALUE_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("email", re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")),
    ("government_id", re.compile(r"^(\d{3}-\d{2}-\d{4}|[A-Z]{5}\d{4}[A-Z]|\d{4}\s?\d{4}\s?\d{4})$")),  # SSN, PAN, Aadhaar
    ("financial", re.compile(r"^([A-Z]{2}\d{2}[A-Z0-9]{11,30}|(?:\d[ -]?){13,19})$")),  # IBAN, card numbers (Luhn-checked)
    ("phone", re.compile(r"^\+?[\d\s().-]{7,20}$")),
]
_LABEL_FOR = {
    "email": "confidential", "phone": "confidential", "person_name": "confidential", "address": "confidential",
    "financial": "restricted", "government_id": "restricted", "sensitive": "restricted",
}


def _luhn(s: str) -> bool:
    digits = [int(c) for c in s if c.isdigit()]
    if not 13 <= len(digits) <= 19:
        return False
    total = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def _value_type(v: str) -> str | None:
    v = v.strip()
    for kind, rx in _VALUE_PATTERNS:
        if rx.match(v):
            if kind == "financial" and not v[:2].isalpha() and not _luhn(v):
                continue
            if kind == "phone" and sum(c.isdigit() for c in v) < 7:
                continue
            return kind
    return None


@dataclass
class Finding:
    column: str
    pii_type: str
    label: str
    confidence: float
    matched: int
    sampled: int
    reason: str


def scan_values(column: str, values: list[str]) -> Finding | None:
    """Classify one column from its name and a sample of values. Values are never returned."""
    name = column.lower().strip()
    hint = None
    for kind, rx in _NAME_HINTS:
        if rx.search(name) and not (kind == "person_name" and _NOT_PEOPLE.search(name)):
            hint = kind
            break
    counts: dict[str, int] = {}
    for v in values:
        t = _value_type(v)
        if t:
            counts[t] = counts.get(t, 0) + 1
    sampled = len(values)
    best = max(counts.items(), key=lambda kv: kv[1]) if counts else None
    ratio = best[1] / sampled if best and sampled else 0.0
    # Phone-shaped values are often just numbers: only trust them with a name hint.
    if best and best[0] == "phone" and hint != "phone":
        best, ratio = None, 0.0
    if best and ratio >= 0.6:
        kind = best[0]
        conf = round(min(0.99, 0.5 + ratio / 2 + (0.1 if hint == kind else 0)), 2)
        return Finding(column, kind, _LABEL_FOR[kind], conf, best[1], sampled, f"{round(ratio * 100)}% of sampled values look like {kind.replace('_', ' ')}")
    if hint:
        matched = counts.get(hint, 0)
        conf = 0.6 if not sampled else round(min(0.95, 0.55 + matched / max(sampled, 1) / 2), 2)
        return Finding(column, hint, _LABEL_FOR[hint], conf, matched, sampled, f'The column name "{column}" suggests {hint.replace("_", " ")}')
    return None


def scan_dataset(con: duckdb.DuckDBPyConnection, ds: Dataset, sample: int = 200) -> list[Finding]:
    """Scan every column of one dataset (a connection with its view, unmasked: this runs as the system)."""
    from app.query import quote, view_name

    findings: list[Finding] = []
    for c in ds.columns:
        name = c["name"]
        values: list[str] = []
        if c.get("type") in ("text", "category", None, ""):
            try:
                rows = con.execute(
                    f"SELECT DISTINCT CAST({quote(name)} AS VARCHAR) FROM {view_name(ds.id)} WHERE {quote(name)} IS NOT NULL LIMIT {int(sample)}"  # nosec B608
                ).fetchall()
                values = [r[0] for r in rows if r[0]]
            except duckdb.Error:
                values = []
        f = scan_values(name, values)
        if f:
            findings.append(f)
    return findings


DEFAULT_POLICIES = [
    {"name": "Restricted data: hidden values for everyone but owners", "rules": {"labels": ["restricted"], "method": "full", "exempt_roles": []}},
    {"name": "Confidential data: partial values for viewers and shared links", "rules": {"labels": ["confidential"], "method": "partial", "exempt_roles": ["editor"]}},
]


def ensure_default_policies(db: Session, workspace_id: str, user_id: str | None) -> bool:
    """Create the two recommended masking policies the first time a workspace is scanned."""
    exists = db.scalar(select(GovernancePolicy.id).where(GovernancePolicy.workspace_id == workspace_id, GovernancePolicy.kind == "masking").limit(1))
    if exists:
        return False
    for p in DEFAULT_POLICIES:
        db.add(GovernancePolicy(workspace_id=workspace_id, kind="masking", name=p["name"], rules=p["rules"], created_by=user_id))
    return True


def scan_workspace(db: Session, workspace_id: str, datasets: list[Dataset], user_id: str | None = None) -> dict:
    """Scan datasets, upsert classifications (keeping people's own decisions), return counts."""
    from app.query import connect

    existing = {
        (c.dataset_id, c.column): c
        for c in db.scalars(select(ColumnClassification).where(ColumnClassification.workspace_id == workspace_id)).all()
    }
    rules: list[tuple[re.Pattern, str, str | None]] = []
    for pol in db.scalars(select(GovernancePolicy).where(GovernancePolicy.workspace_id == workspace_id, GovernancePolicy.kind == "classification",
                                                         GovernancePolicy.enabled.is_(True))).all():
        for p in (pol.rules or {}).get("patterns") or []:
            try:
                rules.append((re.compile(str(p["pattern"])[:100], re.IGNORECASE), p["label"], p.get("pii_type")))
            except re.error:
                continue
    new = updated = 0
    for ds in datasets:
        con = connect(workspace_id, [ds])
        try:
            findings = scan_dataset(con, ds)
        finally:
            con.close()
        found = {f.column for f in findings}
        for c in ds.columns:  # the workspace's own classification rules (column-name patterns)
            for rx, label, pii in rules:
                if rx.search(c["name"]):
                    if c["name"] in found:
                        f = next(x for x in findings if x.column == c["name"])
                        if LABELS.index(label) > LABELS.index(f.label):
                            f.label = label
                    else:
                        findings.append(Finding(c["name"], pii or "sensitive", label, 1.0, 0, 0, "Matches a classification rule"))
                        found.add(c["name"])
                    break
        for f in findings:
            row = existing.get((ds.id, f.column))
            if row is None:
                db.add(ColumnClassification(
                    workspace_id=workspace_id, dataset_id=ds.id, column=f.column, label=f.label, pii_type=f.pii_type,
                    source="scanner", confidence=f.confidence, matched=f.matched, sampled=f.sampled,
                ))
                new += 1
            elif row.source == "scanner":  # a person's label or dismissal is never overwritten
                row.confidence, row.matched, row.sampled = f.confidence, f.matched, f.sampled
                if row.status == "active":
                    row.pii_type, row.label = f.pii_type, f.label
                updated += 1
    created_policies = ensure_default_policies(db, workspace_id, user_id)
    db.commit()
    return {"datasets": len(datasets), "new": new, "updated": updated, "default_policies_created": created_policies}


# ---------- redaction for text leaving the platform (AI prompts, logs) ----------

_REDACT = [
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b"),
    re.compile(r"\b(?:\d[ -]?){12,19}\b"),
    re.compile(r"\+?\d[\d\s().-]{8,}\d"),
]


def redact_text(text: str) -> str:
    """Replace anything that looks like personal data (emails, ids, card and phone numbers) with [redacted]."""
    for rx in _REDACT:
        text = rx.sub("[redacted]", text)
    return text
