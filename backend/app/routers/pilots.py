"""Pilot requests from the website: a public form (no sign-in) and a staff list to work them.

The form is rate limited per address (app/ratelimit.py) and has a honeypot field that real people
never fill. Each request notifies the support staff by email (only logged when email isn't set up).
"""

from __future__ import annotations

import html
import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import PilotRequest
from app.schemas import UtcDatetime
from app.security import require_staff

log = logging.getLogger("app.pilots")

public = APIRouter(tags=["pilots"])
admin = APIRouter(prefix="/support/admin/pilots", tags=["pilots"], dependencies=[Depends(require_staff)])

Database = Literal["postgres", "mysql", "other"]
TeamSize = Literal["1-10", "11-50", "51-200", "200+"]
Status = Literal["new", "contacted", "active", "declined"]


class PilotIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    company: str = Field(min_length=1, max_length=160)
    database: Database
    team_size: TeamSize
    need: str = Field(min_length=10, max_length=1000)
    # Honeypot: hidden in the form, so only bots fill it.
    website: str | None = Field(default=None, max_length=200)

    @field_validator("name", "company", "need")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("This can't be empty.")
        return v


class PilotOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    name: str
    email: str
    company: str
    database: str
    team_size: str
    need: str
    status: str
    note: str | None
    created_at: UtcDatetime
    updated_at: UtcDatetime


class PilotPatch(BaseModel):
    status: Status | None = None
    note: str | None = Field(default=None, max_length=1000)


@public.post("/pilot-requests", status_code=status.HTTP_201_CREATED)
def create_pilot_request(body: PilotIn, db: Session = Depends(get_db)):
    if body.website:  # a bot: answer as if it worked, store nothing
        return {"ok": True}
    from app.email_check import check_email

    if check_email(str(body.email)) == "invalid":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That email address can't receive mail. Check it for typos.")
    p = PilotRequest(name=body.name, email=str(body.email).lower(), company=body.company, database=body.database,
                     team_size=body.team_size, need=body.need)
    db.add(p)
    db.commit()
    _notify_staff(p)
    return {"ok": True}


def _notify_staff(p: PilotRequest) -> None:
    """Tell the support staff a pilot request arrived. Never breaks the request."""
    from app.email import app_link, render, send

    staff = sorted(get_settings().staff_emails)
    if not staff:
        log.warning("pilot request %s arrived but SUPPORT_STAFF_EMAILS is empty", p.id)
        return
    lines = [f"{p.name} ({p.email}) at {p.company}", f"Database: {p.database} · team: {p.team_size}", p.need]
    try:
        send(staff, f"Pilot request: {p.company}", render("New pilot request", [html.escape(x) for x in lines],
                                                           ("Open pilot requests", app_link("/support/admin/pilots"))),
             "\n".join(lines))
    except Exception:  # email trouble must not lose the request
        log.exception("couldn't notify staff about pilot request %s", p.id)


@admin.get("", response_model=list[PilotOut])
def list_pilot_requests(status_filter: Status | None = None, db: Session = Depends(get_db)):
    stmt = select(PilotRequest).order_by(PilotRequest.created_at.desc()).limit(500)
    if status_filter:
        stmt = stmt.where(PilotRequest.status == status_filter)
    return db.scalars(stmt).all()


@admin.patch("/{pid}", response_model=PilotOut)
def update_pilot_request(pid: str, body: PilotPatch, db: Session = Depends(get_db)):
    p = db.get(PilotRequest, pid)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pilot request not found")
    if body.status is not None:
        p.status = body.status
    if body.note is not None:
        p.note = body.note.strip() or None
    db.commit()
    db.refresh(p)
    return p


@admin.delete("/{pid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pilot_request(pid: str, db: Session = Depends(get_db)):
    """Remove a request (for example when the person asks to be forgotten)."""
    p = db.get(PilotRequest, pid)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pilot request not found")
    db.delete(p)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
