"""POST /ask: a plain-English question -> answer sentence + chart (rule-based for now)."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analytics.semantic import ask_vocabulary
from app.ask import phrase_words, parse_question, suggestions
from app.db import get_db
from app.insights import chart_insight
from app.models import Dataset, WorkspaceMember
from app.query import QueryError, connect
from app.schemas import InsightOut
from app.security import current_membership
from app.work import answer_work

router = APIRouter(prefix="/ask", tags=["ask"])


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=300)


class AnswerCheck(BaseModel):
    metric: str
    shown: float  # what the bars in the chart add up to
    total: float  # the same measure over every row the answer used
    groups_shown: int
    limited: bool  # a top/bottom N answer, so shown can be less than total


class AnswerWork(BaseModel):
    """How the answer was worked out, read off the query that ran, so it can be checked by hand."""

    steps: list[str]
    rows_used: int
    rows_total: int
    left_out: list[str] = Field(default_factory=list)
    check: AnswerCheck | None = None
    row_filters: list[dict] = Field(default_factory=list)  # for GET /datasets/{id}/rows?filters=


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
    work: AnswerWork | None = None


def _datasets(db: Session, member: WorkspaceMember) -> list[Dataset]:
    return list(db.scalars(select(Dataset).where(Dataset.workspace_id == member.workspace_id).order_by(Dataset.created_at.desc())))


@router.get("/suggestions", response_model=list[str])
def ask_suggestions(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return suggestions(_datasets(db, member))


@router.post("", response_model=AskOut)
def ask(body: AskIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    question = body.question.strip()
    datasets = _datasets(db, member)
    if not datasets:
        return AskOut(answered=False, question=question, message="Add a dataset first, then ask about it.")
    con = connect(member.workspace_id, datasets)
    try:
        parsed = parse_question(question, datasets, con, vocabulary=ask_vocabulary(db, member.workspace_id, phrase_words))
        if parsed is None:
            return AskOut(
                answered=False,
                question=question,
                message="I couldn't match that to your columns. Try naming one, like these:",
                suggestions=suggestions(datasets),
            )
        try:
            rows, insight = chart_insight(con, parsed.spec, parsed.dataset, parsed.filters)
            work = answer_work(con, parsed.spec, parsed.dataset, parsed.filters, rows)
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
        work=AnswerWork(**work),
    )
