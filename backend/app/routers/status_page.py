"""GET /status for the public status page; staff post and update incidents."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import status as status_mod
from app.db import get_db
from app.models import Incident, IncidentUpdate
from app.security import require_staff
from app.support_schemas import IncidentIn, IncidentOut, IncidentUpdateIn

router = APIRouter(tags=["status"])


@router.get("/status")
def public_status(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=30"
    return status_mod.summary(db)


admin = APIRouter(prefix="/status/admin", tags=["status-admin"], dependencies=[Depends(require_staff)])


def _incident(db: Session, incident_id: str) -> Incident:
    inc = db.get(Incident, incident_id)
    if inc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Incident not found")
    return inc


def _components(names: list[str]) -> list[str]:
    bad = [c for c in names if c not in status_mod.COMPONENT_IDS]
    if bad:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown component: {', '.join(bad)}")
    return sorted(set(names))


@admin.get("/incidents", response_model=list[IncidentOut])
def list_incidents(db: Session = Depends(get_db)):
    return [IncidentOut.model_validate(i) for i in db.scalars(select(Incident).order_by(Incident.created_at.desc()).limit(100))]


@admin.post("/incidents", response_model=IncidentOut, status_code=status.HTTP_201_CREATED)
def create_incident(body: IncidentIn, db: Session = Depends(get_db)):
    inc = Incident(title=body.title, impact=body.impact, status=body.status, components=_components(body.components))
    if body.status == "resolved":
        inc.resolved_at = datetime.now(timezone.utc)
    inc.updates.append(IncidentUpdate(status=body.status, message=body.message))
    db.add(inc)
    db.commit()
    db.refresh(inc)
    status_mod.invalidate()
    return IncidentOut.model_validate(inc)


@admin.post("/incidents/{incident_id}/updates", response_model=IncidentOut)
def add_update(incident_id: str, body: IncidentUpdateIn, db: Session = Depends(get_db)):
    inc = _incident(db, incident_id)
    inc.updates.append(IncidentUpdate(status=body.status, message=body.message))
    inc.status = body.status
    inc.resolved_at = datetime.now(timezone.utc) if body.status == "resolved" else None
    db.commit()
    db.refresh(inc)
    status_mod.invalidate()
    return IncidentOut.model_validate(inc)


@admin.delete("/incidents/{incident_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_incident(incident_id: str, db: Session = Depends(get_db)):
    db.delete(_incident(db, incident_id))
    db.commit()
    status_mod.invalidate()
