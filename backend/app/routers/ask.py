"""POST /ask: a plain-English question -> answer sentence + chart (rule-based for now)."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.rate_limit import per_user
from app.ask import parse_question, suggestions
from app.db import get_db
from app.insights import chart_insight
from app.models import Dataset, WorkspaceMember
from app.query import QueryError, connect
from app.schemas import InsightOut
from app.security import current_membership

router = APIRouter(prefix="/ask", tags=["ask"])


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=300)


class AskOut(BaseModel):
    answered: bool
    question: str
    spec: dict | None = None
    rows: list[dict] = Field(default_factory=list)
    insight: InsightOut | None = None
    dataset_id: str | None = None
    dataset_name: str | None = None
    understood: list[str] = Field(default_factory=list)
    date_from: str | None = None
    date_to: str | None = None
    message: str | None = None
    suggestions: list[str] = Field(default_factory=list)


def _datasets(db: Session, member: WorkspaceMember) -> list[Dataset]:
    return list(db.scalars(select(Dataset).where(Dataset.workspace_id == member.workspace_id).order_by(Dataset.created_at.desc())))


@router.get("/suggestions", response_model=list[str])
def ask_suggestions(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return suggestions(_datasets(db, member))


@router.post("", response_model=AskOut, dependencies=[Depends(per_user("ask"))])
def ask(body: AskIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    question = body.question.strip()
    datasets = _datasets(db, member)
    if not datasets:
        return AskOut(answered=False, question=question, message="Add a dataset first, then ask about it.")
    con = connect(member.workspace_id, datasets)
    try:
        parsed = parse_question(question, datasets, con)
        if parsed is None:
            return AskOut(
                answered=False,
                question=question,
                message="I couldn't match that to your columns. Try naming one, like these:",
                suggestions=suggestions(datasets),
            )
        try:
            rows, insight = chart_insight(con, parsed.spec, parsed.dataset, parsed.filters)
        except QueryError as e:
            return AskOut(answered=False, question=question, message=str(e), suggestions=suggestions(datasets))
    finally:
        con.close()
    f = parsed.filters
    return AskOut(
        answered=True,
        question=question,
        spec=parsed.spec,
        rows=rows,
        insight=InsightOut(**insight.__dict__),
        dataset_id=parsed.dataset.id,
        dataset_name=parsed.dataset.name,
        understood=parsed.understood,
        date_from=f.date_from.isoformat() if f and f.date_from else None,
        date_to=f.date_to.isoformat() if f and f.date_to else None,
    )
