"""Ready-made dashboard templates: list, suggest a column mapping, apply."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Chart, Dashboard, WorkspaceMember
from app.routers.dashboards import _editor, _out
from app.routers.datasets import owned_dataset
from app.schemas import DashboardOut
from app.security import current_membership
from app.templates import TEMPLATES, TemplateError, build, public_template, suggest_mapping

router = APIRouter(tags=["templates"])
class TemplateApplyIn(BaseModel):
    dataset_id: str
    mapping: dict[str, str | None]
    name: str | None = None


@router.get("/templates")
def list_templates(member: WorkspaceMember = Depends(current_membership)):
    return [public_template(k) for k in TEMPLATES]


@router.get("/templates/{template_id}/suggest")
def suggest(template_id: str, dataset_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    if template_id not in TEMPLATES:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template not found")
    return suggest_mapping(template_id, owned_dataset(db, member, dataset_id))


@router.post("/templates/{template_id}/apply", response_model=DashboardOut, status_code=status.HTTP_201_CREATED)
def apply_template(
    template_id: str, body: TemplateApplyIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)
):
    _editor(member)
    if template_id not in TEMPLATES:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template not found")
    ds = owned_dataset(db, member, body.dataset_id)
    try:
        charts, date_fields, filters = build(template_id, ds, body.mapping)
    except TemplateError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    name = (body.name or "").strip() or f"{TEMPLATES[template_id]['name']} · {ds.name}"
    d = Dashboard(
        workspace_id=member.workspace_id, name=name[:200], description=f"{TEMPLATES[template_id]['name']} template, from {ds.name}",
        date_fields=date_fields, filter_columns=filters, created_by=member.user_id,
    )
    db.add(d)
    db.flush()
    for n, (kind, spec) in enumerate(charts):
        db.add(Chart(dashboard_id=d.id, dataset_id=ds.id, spec=spec, kind=kind, position=n))
    db.commit()
    db.refresh(d)
    return _out(db, d, member)
