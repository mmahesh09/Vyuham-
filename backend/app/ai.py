"""Claude for SQL and pipeline help. One entry point (`ask_json`) that every AI feature uses.

- The model only ever sees the workspace's real metadata (table names, column names and types, row
  counts), built by `schema_context` for the person asking: hidden datasets and columns are left out,
  and no example values are sent for any column that is classified or masked. Free text that goes in
  (error messages, questions) passes through `governance.redact_text` first.
- Every request is recorded as an AiAction: kind, model, tokens, timing and what it proposed. The
  prompt is not stored.
- Without ANTHROPIC_API_KEY the AI features answer 503 with a clear message; nothing is faked.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app import plans
from app.config import get_settings
from app.models import AiAction, Dataset, WorkspaceMember

log = logging.getLogger("app.ai")


class AiUnavailable(RuntimeError):
    """AI isn't configured on this server."""


class AiError(RuntimeError):
    """The model couldn't produce a usable answer; the message is shown as-is."""


@dataclass
class AiResult:
    data: dict
    action: AiAction


_client = None


def _get_client():
    global _client
    s = get_settings()
    if not s.anthropic_api_key:
        raise AiUnavailable("AI isn't set up on this server yet. An administrator needs to set ANTHROPIC_API_KEY.")
    if _client is None:
        import anthropic

        _client = anthropic.Anthropic(api_key=s.anthropic_api_key, timeout=120.0, max_retries=2)
    return _client


def ai_enabled() -> bool:
    return bool(get_settings().anthropic_api_key)


def ask_json(
    db: Session, member: WorkspaceMember, kind: str, system: str, prompt: str, schema: dict,
    *, effort: str = "medium", max_tokens: int = 16000, ref_kind: str | None = None, ref_id: str | None = None,
) -> AiResult:
    """One structured-output request. Returns the parsed JSON and its AiAction (already committed)."""
    import anthropic

    s = get_settings()
    client = _get_client()
    started = time.perf_counter()
    action = AiAction(workspace_id=member.workspace_id, user_id=member.user_id, kind=kind, model=s.ai_model,
                      ref_kind=ref_kind, ref_id=ref_id, outcome="proposed")
    # Holds this request's AI credits (402 when the plan's allowance is spent) before anything is sent.
    plans.reserve_ai_credits(db, member, action)
    try:
        response = client.beta.messages.create(
            model=s.ai_model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": prompt}],
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.RateLimitError as e:
        _fail(db, action, started, "error")
        raise AiError("The AI service is busy right now. Try again in a minute.") from e
    except anthropic.APIStatusError as e:
        _fail(db, action, started, "error")
        log.warning("AI request failed: %s %s", e.status_code, type(e).__name__)
        raise AiError("The AI service couldn't answer just now. Try again.") from e
    except anthropic.APIConnectionError as e:
        _fail(db, action, started, "error")
        raise AiError("Couldn't reach the AI service. Try again.") from e
    except Exception:
        _fail(db, action, started, "error")  # never leave credits held on a request that didn't finish
        raise

    usage = getattr(response, "usage", None)
    action.input_tokens = getattr(usage, "input_tokens", None)
    action.output_tokens = getattr(usage, "output_tokens", None)
    action.model = getattr(response, "model", None) or s.ai_model
    action.duration_ms = int((time.perf_counter() - started) * 1000)
    if response.stop_reason == "refusal":
        action.status, action.outcome, action.credits = "refused", None, 0
        db.add(action)
        db.commit()
        raise AiError("The AI declined this request. Try rephrasing it.")
    if response.stop_reason == "max_tokens":
        action.status, action.outcome, action.credits = "error", None, 0
        db.add(action)
        db.commit()
        raise AiError("The answer was too long. Try a smaller request.")
    text = next((b.text for b in response.content if getattr(b, "type", None) == "text"), "")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        action.status, action.outcome, action.credits = "error", None, 0
        db.add(action)
        db.commit()
        raise AiError("The AI's answer couldn't be read. Try again.") from e
    action.output = data
    action.status = "ok"  # the held credits are kept
    db.add(action)
    db.commit()
    db.refresh(action)
    return AiResult(data, action)


def _fail(db: Session, action: AiAction, started: float, status: str) -> None:
    """The provider never produced an answer: no credits are charged."""
    action.status, action.outcome, action.credits = status, None, 0
    action.duration_ms = int((time.perf_counter() - started) * 1000)
    db.add(action)
    db.commit()


def update_output(db: Session, action: AiAction, data: dict) -> None:
    """Store the checked version of what the AI proposed (after validation and repair)."""
    action.output = data
    db.commit()


# ---------- workspace context ----------


def schema_context(db: Session, member: WorkspaceMember, datasets: list[Dataset]) -> tuple[str, list[dict]]:
    """The tables this member can see, as text for the prompt and as data (for checking AI output)."""
    from sqlalchemy import select

    from app.governance import column_method, member_access, redact_text, visible_datasets
    from app.models import ColumnClassification
    from app.query import table_names

    access = member_access(db, member)
    visible = visible_datasets(db, member, datasets, access)
    names = table_names(visible)
    classified = {
        (c.dataset_id, c.column)
        for c in db.scalars(select(ColumnClassification).where(
            ColumnClassification.workspace_id == member.workspace_id, ColumnClassification.status == "active"
        )).all()
    }
    lines: list[str] = []
    tables: list[dict] = []
    for d in visible:
        cols = []
        for c in d.columns:
            method = column_method(access, d.id, c["name"])
            if method == "hide":
                continue
            entry = {"name": c["name"], "type": c.get("type", "text")}
            if method:
                entry["masked"] = method
            safe = not method and (d.id, c["name"]) not in classified and c.get("type") == "category"
            if safe and c.get("examples"):
                entry["examples"] = [redact_text(str(v))[:40] for v in c["examples"][:3]]
            cols.append(entry)
        tables.append({"table": names[d.id], "dataset_id": d.id, "name": d.name, "rows": d.row_count, "layer": d.layer, "columns": cols})
        col_text = ", ".join(
            f'{json.dumps(c["name"])} {c["type"]}'
            + (f" (masked: {c['masked']})" if c.get("masked") else "")
            + (f" e.g. {', '.join(c['examples'])}" if c.get("examples") else "")
            for c in cols
        )
        layer = f", layer {d.layer}" if d.layer else ""
        lines.append(f"- {names[d.id]} ({d.row_count} rows{layer}; dataset {json.dumps(d.name)}): {col_text}")
    text = "\n".join(lines) if lines else "(The workspace has no datasets yet.)"
    return text, tables


ENGINE_NOTES = (
    "The engine is DuckDB. Queries are read-only: one SELECT (WITH ... SELECT is fine). "
    "Quote column names that aren't plain lowercase identifiers with double quotes. "
    "Use only the tables and columns listed; never invent a table or a column. If the data needed "
    "isn't there, say so in the explanation and return an empty sql string. "
    "Parameters written as {{name}} are placeholders the person fills in; keep any that are present."
)
